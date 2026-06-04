import { auth, clerkClient } from "@clerk/nextjs/server";
import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { renderToStream } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";
import React from "react";
import { MonochromeDigestDocument } from "../../../../components/MonochromeDigestDocument";

export const runtime = "nodejs";

type VerifiedToken = { sub?: string; userId?: string };

let globalConvexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for digest PDF export");
  if (!globalConvexClient) globalConvexClient = new ConvexHttpClient(convexUrl);
  return globalConvexClient;
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getAuthenticatedUserId(request: NextRequest) {
  const session = await auth();
  if (session.userId) return session.userId;

  const urlToken = request.nextUrl.searchParams.get("token");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined;
  const token = urlToken || bearerToken;
  if (!token) return null;

  const client = await clerkClient();
  const verified = await (client as any).verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }) as VerifiedToken;
  return verified.sub ?? verified.userId ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

    const dateStr = request.nextUrl.searchParams.get("date") || todayDateStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }

    const exportData = await getConvexClient().query((api as any).agents.getDigestExportData, { userId, dateStr });
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
