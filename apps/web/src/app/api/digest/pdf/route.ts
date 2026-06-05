import { auth, clerkClient } from "@clerk/nextjs/server";
import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { renderToStream } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";
import React from "react";
import { MonochromeDigestDocument } from "../../../../components/MonochromeDigestDocument";

export const runtime = "nodejs";

type VerifiedToken = { sub?: string; userId?: string };

function createConvexClient(token: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for digest PDF export");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client;
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getAuthenticatedUser(request: NextRequest) {
  const session = await auth();
  if (session.userId) {
    const token = await session.getToken();
    if (!token) return null;
    return { userId: session.userId, token };
  }

  const urlToken = request.nextUrl.searchParams.get("token");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined;
  const token = urlToken || bearerToken;
  if (!token) return null;

  try {
    const client = await clerkClient();
    const verified = await (client as any).verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }) as VerifiedToken;
    const userId = verified.sub ?? verified.userId ?? null;
    return userId ? { userId, token } : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const ticket = request.nextUrl.searchParams.get("ticket");
    let exportData: any = null;
    let dateStr = request.nextUrl.searchParams.get("date") || todayDateStr();

    if (ticket) {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
      if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for digest PDF export");
      const client = new ConvexHttpClient(convexUrl);
      exportData = await client.mutation(api.agents.verifyDownloadToken, { token: ticket });
      if (!exportData) {
        return NextResponse.json({ error: "Ungültiges oder abgelaufenes Ticket" }, { status: 401 });
      }
      dateStr = exportData.dateStr;
    } else {
      const authenticated = await getAuthenticatedUser(request);
      if (!authenticated) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
      }

      exportData = await createConvexClient(authenticated.token).query((api as any).agents.getDigestExportData, { userId: authenticated.userId, dateStr });
    }

    const stream = await renderToStream(
      React.createElement(MonochromeDigestDocument, {
        dateStr,
        familyName: exportData.family?.name ?? "FamilyCal",
        userName: exportData.user?.name ?? exportData.user?.email ?? "Familienmitglied",
        digestBody: exportData.digest?.body ?? "Keine Zusammenfassung vorhanden.",
        events: exportData.events ?? [],
      }) as any,
    );

    return new NextResponse(stream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="digest-${dateStr}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("Digest PDF export failed", error);
    return NextResponse.json({ error: error?.message ?? "PDF konnte nicht erstellt werden." }, { status: 500 });
  }
}
