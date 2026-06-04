import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const CAREGIVER_PIN_TTL_MS = 10 * 60 * 1000;
const CAREGIVER_PIN_ROLES = new Set(["ROLE-001", "ROLE-002"]);

type CaregiverPinUser = {
  clerkId?: string;
  role: string;
  familyId?: unknown;
};

export function assertCanManageCaregiverPins(user: CaregiverPinUser) {
  if (!CAREGIVER_PIN_ROLES.has(user.role) || !user.familyId) {
    throw new ConvexError("Nur Elternteile oder Familieninhaber können PINs generieren.");
  }
}

// Kryptographisch sichere Zufallsquelle (Web Crypto, in der Convex- und Node-Runtime global verfügbar).
// Liefert eine gleichverteilte Gleitkommazahl in [0, 1) – ersetzt das unsichere Math.random für die PIN-Erzeugung.
function secureRandomFraction(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 0x1_00_00_00_00;
}

export function createCaregiverPinRecord(args: {
  familyId: unknown;
  creatorId: string;
  now?: number;
  random?: () => number;
}) {
  const now = args.now ?? Date.now();
  const random = args.random ?? secureRandomFraction;
  const pin = Math.floor(100000 + random() * 900000).toString();

  return {
    familyId: args.familyId,
    pin,
    expiresAt: now + CAREGIVER_PIN_TTL_MS,
    creatorId: args.creatorId,
  };
}

export function isActiveCaregiverPin(pin: { expiresAt: number }, now = Date.now()) {
  return pin.expiresAt > now;
}

export function validateCaregiverPinRecord(
  record: ({ familyId: unknown; expiresAt: number; familyName?: string | null } & Record<string, unknown>) | null,
  now = Date.now(),
) {
  if (!record) return { valid: false as const, error: "PIN wurde nicht gefunden." };
  if (!isActiveCaregiverPin(record, now)) return { valid: false as const, error: "PIN ist abgelaufen." };

  return {
    valid: true as const,
    familyId: record.familyId,
    familyName: record.familyName ?? "Unbekannt",
    role: "ROLE-005",
  };
}

async function getAuthorizedUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Du musst angemeldet sein, um Caregiver-PINs zu verwalten.");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) throw new ConvexError("Benutzerprofil wurde nicht gefunden.");
  assertCanManageCaregiverPins(user);
  return user;
}

export async function deleteFamilyPins(ctx: any, familyId: unknown) {
  const existingPins = await ctx.db
    .query("caregiverPins")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", familyId))
    .collect();

  for (const existingPin of existingPins) {
    await ctx.db.delete(existingPin._id);
  }
}

export const generatePin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthorizedUser(ctx);
    await deleteFamilyPins(ctx, user.familyId);

    // Globale Eindeutigkeit der PIN sicherstellen: Bei Kollision (gleiche PIN in anderer Familie)
    // neu generieren, damit verifyPin via by_pin-Index deterministisch die richtige Familie trifft.
    let record: ReturnType<typeof createCaregiverPinRecord> | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = createCaregiverPinRecord({
        familyId: user.familyId,
        creatorId: user.clerkId,
      });
      const existing = await ctx.db
        .query("caregiverPins")
        .withIndex("by_pin", (q: any) => q.eq("pin", candidate.pin))
        .first();
      if (!existing) {
        record = candidate;
        break;
      }
    }

    if (!record) {
      throw new ConvexError("PIN konnte nicht generiert werden. Bitte erneut versuchen.");
    }

    await ctx.db.insert("caregiverPins", record as any);
    return record;
  },
});

export const getActivePin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthorizedUser(ctx);

    const pins = await ctx.db
      .query("caregiverPins")
      .withIndex("by_familyId", (q: any) => q.eq("familyId", user.familyId))
      .collect();
    const activePin = pins.find((pin: { expiresAt: number }) => isActiveCaregiverPin(pin));

    if (!activePin) return null;
    // Nur die für die UI benötigten Felder zurückgeben – keine internen Felder (creatorId, _id, _creationTime) leaken.
    return { pin: activePin.pin, expiresAt: activePin.expiresAt };
  },
});

export const verifyPin = query({
  args: {
    pin: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("caregiverPins")
      .withIndex("by_pin", (q) => q.eq("pin", args.pin))
      .first();

    if (!record) return validateCaregiverPinRecord(null);

    const family = await ctx.db.get(record.familyId);
    return validateCaregiverPinRecord({
      ...record,
      familyName: family?.name,
    });
  },
});
