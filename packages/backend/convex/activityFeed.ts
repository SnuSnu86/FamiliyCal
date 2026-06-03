import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { type Auth } from "convex/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIMIT = 100;

export type ActivityFeedType =
  | "chat_message"
  | "event_comment"
  | "memo_updated"
  | "list_updated"
  | "album_updated"
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

export const list = query({
  args: {
    familyId: v.id("families"),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    const lowerBound = Date.now() - THIRTY_DAYS_MS;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit ?? 25)));
    const cursor = args.cursor ?? Number.POSITIVE_INFINITY;

    const items = await ctx.db
      .query("activityFeedEntries")
      .withIndex("by_familyId_createdAt", (q) =>
        q.eq("familyId", args.familyId).gte("createdAt", lowerBound).lt("createdAt", cursor),
      )
      .order("desc")
      .take(limit + 1);

    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? page[page.length - 1]?.createdAt : null;

    return {
      items: page,
      nextCursor,
      hasMore: nextCursor !== null,
    };
  },
});
