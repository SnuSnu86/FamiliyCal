import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { type Auth, paginationOptsValidator } from "convex/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIMIT = 100;

export type ActivityFeedType =
  | "chat_message"
  | "event_comment"
  | "calendar_event"
  | "memo_updated"
  | "memo_deleted"
  | "list_updated"
  | "list_deleted"
  | "album_updated"
  | "album_deleted"
  | "quota_updated";

export type ActivityFeedEntityType = "chatThread" | "calendarEvent" | "memo" | "list" | "album" | "user" | "family";

async function requireFamilyMember(ctx: { auth: Auth; db: any }, familyId: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "ACTIVITY_FEED_ACCESS_DENIED", message: "Bitte melde dich an." });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .first();

  if (!user || user.familyId !== familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }

  return { userId: identity.subject, user };
}

export async function recordActivity(
  ctx: { db: any },
  entry: {
    familyId: any;
    actorId: string;
    type: ActivityFeedType;
    entityType: ActivityFeedEntityType;
    entityId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
  },
) {
  await ctx.db.insert("activityFeedEntries", {
    familyId: entry.familyId,
    actorId: entry.actorId,
    type: entry.type,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: entry.metadata,
    createdAt: entry.createdAt ?? Date.now(),
  });
}

export async function listActivityFeedHandler(
  ctx: { auth: Auth; db: any },
  args: { familyId: any; paginationOpts: { numItems: number; cursor: string | null } },
) {
  await requireFamilyMember(ctx, args.familyId);
  const lowerBound = Date.now() - THIRTY_DAYS_MS;
  // Convex's cursor pagination encodes the full index key (createdAt + _id), so
  // entries that share the same createdAt are no longer dropped across page
  // boundaries. The 30-day retention window is enforced via the index range and
  // the page size is capped at MAX_LIMIT.
  const numItems = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.paginationOpts.numItems || 25)));

  return await ctx.db
    .query("activityFeedEntries")
    .withIndex("by_familyId_createdAt", (q: any) =>
      q.eq("familyId", args.familyId).gte("createdAt", lowerBound),
    )
    .order("desc")
    .paginate({ ...args.paginationOpts, numItems });
}

export const list = query({
  args: {
    familyId: v.id("families"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => listActivityFeedHandler(ctx, args),
});
