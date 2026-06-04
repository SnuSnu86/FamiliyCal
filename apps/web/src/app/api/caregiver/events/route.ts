import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken } from "../../../../lib/caregiverAuth";

let globalConvexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for caregiver events");
  if (!globalConvexClient) globalConvexClient = new ConvexHttpClient(convexUrl);
  return globalConvexClient;
}

function getCurrentWeekRange(now = new Date()) {
  const start = new Date(now);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export async function GET(request: Request) {
  try {
    const token = (await cookies()).get("caregiver_session")?.value;
    const session = token ? verifyToken(token) : null;
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

    const secret = process.env.CAREGIVER_API_SECRET;
    if (!secret) return NextResponse.json({ error: "CAREGIVER_API_SECRET is required" }, { status: 500 });

    const date = new URL(request.url).searchParams.get("date");
    const rangeAnchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : new Date();
    const { startDate, endDate } = getCurrentWeekRange(rangeAnchor);
    const events = await getConvexClient().query(api.calendarEvents.listEventsForCaregiver, {
      familyId: session.familyId as any,
      startDate,
      endDate,
      secret,
    });

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error("Caregiver events failed", error);
    return NextResponse.json({ error: error?.message ?? "Termine konnten nicht geladen werden." }, { status: 500 });
  }
}
