import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse, type NextRequest } from "next/server";
import { signToken } from "../../../lib/caregiverAuth";

let globalConvexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for caregiver PIN verification");
  if (!globalConvexClient) globalConvexClient = new ConvexHttpClient(convexUrl);
  return globalConvexClient;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { pin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";

    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: "Bitte gib einen 6-stelligen PIN ein." }, { status: 400 });
    }

    const result = await getConvexClient().query(api.caregiverPins.verifyPin, { pin });
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    if (result.role !== "ROLE-005" && result.role !== "ROLE-006") {
      return NextResponse.json({ error: "Caregiver-Rolle ist ungültig." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, familyName: result.familyName });
    response.cookies.set("caregiver_session", signToken({
      familyId: String(result.familyId),
      role: result.role,
      familyName: result.familyName,
    }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error: any) {
    console.error("Caregiver PIN verification failed", error);
    return NextResponse.json({ error: error?.message ?? "PIN konnte nicht geprüft werden." }, { status: 500 });
  }
}
