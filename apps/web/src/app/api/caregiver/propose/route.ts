import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "../../../../lib/caregiverAuth";

let globalConvexClient: ConvexHttpClient | null = null;

const proposalSchema = z
  .object({
    title: z.string().trim().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    description: z.string().trim().optional(),
    timezone: z.string().refine(isValidTimeZone).optional(),
  })
  .refine((value) => {
    const start = localDateTimeToUtc(value.date, value.startTime, value.timezone ?? "Europe/Berlin").getTime();
    const end = localDateTimeToUtc(value.date, value.endTime, value.timezone ?? "Europe/Berlin").getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start < end;
  }, {
    message: "Die Startzeit muss vor der Endzeit liegen.",
    path: ["endTime"],
  })
  .transform((value) => {
    const timezone = value.timezone ?? "Europe/Berlin";
    const startDate = localDateTimeToUtc(value.date, value.startTime, timezone);
    const endDate = localDateTimeToUtc(value.date, value.endTime, timezone);
    return {
      title: value.title,
      description: value.description,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      allDay: false,
    };
  });

function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function localDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = timeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for caregiver proposals");
  if (!globalConvexClient) globalConvexClient = new ConvexHttpClient(convexUrl);
  return globalConvexClient;
}

export async function POST(request: Request) {
  try {
    const token = (await cookies()).get("caregiver_session")?.value;
    const session = token ? verifyToken(token) : null;
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (session.role === "ROLE-006") {
      return NextResponse.json({ error: "Diese Caregiver-Rolle darf keine Terminvorschläge erstellen." }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Termindaten." }, { status: 400 });
    }

    const parsed = proposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Termindaten." }, { status: 400 });
    }

    const secret = process.env.CAREGIVER_API_SECRET;
    if (!secret) return NextResponse.json({ error: "CAREGIVER_API_SECRET is required" }, { status: 500 });

    const event = await getConvexClient().mutation((api.calendarEvents as any).proposeEventForCaregiver, {
      familyId: session.familyId as any,
      ...parsed.data,
      description: parsed.data.description || undefined,
      secret,
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    console.error("Caregiver proposal failed", error);
    return NextResponse.json({ error: error?.message ?? "Terminvorschlag konnte nicht gespeichert werden." }, { status: 500 });
  }
}
