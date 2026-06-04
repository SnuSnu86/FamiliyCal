import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import { listActivityFeedHandler, recordActivity } from "./activityFeed";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function expectConvexError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ConvexError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<any>).data.code).toBe(code);
  }
}

describe("recordActivity", () => {
  test("inserts an entry and defaults createdAt when omitted", async () => {
    const inserts: Array<{ table: string; value: any }> = [];
    const ctx = { db: { insert: async (table: string, value: any) => { inserts.push({ table, value }); } } };

    const before = Date.now();
    await recordActivity(ctx as any, {
      familyId: "famA",
      actorId: "u1",
      type: "memo_deleted",
      entityType: "memo",
      entityId: "memo-1",
      summary: "Memo gelöscht",
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("activityFeedEntries");
    expect(inserts[0].value).toMatchObject({
      familyId: "famA",
      actorId: "u1",
      type: "memo_deleted",
      entityType: "memo",
      entityId: "memo-1",
      summary: "Memo gelöscht",
    });
    expect(inserts[0].value.createdAt).toBeGreaterThanOrEqual(before);
  });

  test("preserves an explicit createdAt", async () => {
    const inserts: any[] = [];
    const ctx = { db: { insert: async (_t: string, value: any) => { inserts.push(value); } } };
    await recordActivity(ctx as any, {
      familyId: "famA",
      actorId: "u1",
      type: "chat_message",
      entityType: "chatThread",
      summary: "Neue Nachricht",
      createdAt: 42,
    });
    expect(inserts[0].createdAt).toBe(42);
  });
});

// Mock ctx for the list handler: an authenticated family member plus a feed
// query that records the index predicates and pagination options it receives.
function makeListCtx(opts: {
  identity: { subject: string } | null;
  user: any;
  paginateResult?: any;
}) {
  const capture: any = { eq: [], gte: [], opts: null, userIndex: null, userEq: [] };
  const ctx = {
    auth: { getUserIdentity: async () => opts.identity },
    db: {
      query: (table: string) => {
        if (table === "users") {
          return {
            withIndex: (name: string, fn: (q: any) => any) => {
              capture.userIndex = name;
              const q: any = { eq: (f: string, v: unknown) => { capture.userEq.push([f, v]); return q; } };
              fn(q);
              return { first: async () => opts.user, unique: async () => opts.user };
            },
          };
        }
        return {
          withIndex: (_n: string, fn: (q: any) => any) => {
            const q: any = {
              eq: (f: string, v: unknown) => { capture.eq.push([f, v]); return q; },
              gte: (f: string, v: unknown) => { capture.gte.push([f, v]); return q; },
            };
            fn(q);
            return {
              order: (_o: string) => ({
                paginate: async (paginationOpts: any) => {
                  capture.opts = paginationOpts;
                  return opts.paginateResult ?? { page: [], isDone: true, continueCursor: "" };
                },
              }),
            };
          },
        };
      },
    },
  };
  return { ctx, capture };
}

describe("listActivityFeedHandler", () => {
  test("rejects an unauthenticated caller", async () => {
    const { ctx } = makeListCtx({ identity: null, user: null });
    await expectConvexError(
      listActivityFeedHandler(ctx as any, { familyId: "famA", paginationOpts: { numItems: 25, cursor: null } }),
      "ACTIVITY_FEED_ACCESS_DENIED",
    );
  });

  test("rejects a caller from a different family", async () => {
    const { ctx } = makeListCtx({ identity: { subject: "u1" }, user: { familyId: "famB" } });
    await expectConvexError(
      listActivityFeedHandler(ctx as any, { familyId: "famA", paginationOpts: { numItems: 25, cursor: null } }),
      "FAMILY_ACCESS_DENIED",
    );
  });

  test("scopes to the family, enforces the 30-day window and caps the page size at 100", async () => {
    const { ctx, capture } = makeListCtx({
      identity: { subject: "u1" },
      user: { familyId: "famA" },
      paginateResult: { page: [{ _id: "1" }], isDone: false, continueCursor: "next" },
    });

    const before = Date.now();
    const result = await listActivityFeedHandler(ctx as any, {
      familyId: "famA",
      paginationOpts: { numItems: 9999, cursor: null },
    });

    // The auth lookup must resolve the user by the authenticated identity's
    // clerkId, not bypass the predicate (guards against a regression that would
    // let any user resolve to the mocked record).
    expect(capture.userIndex).toBe("by_clerkId");
    expect(capture.userEq).toContainEqual(["clerkId", "u1"]);
    expect(capture.eq).toContainEqual(["familyId", "famA"]);
    const [, lowerBound] = capture.gte.find(([f]: [string]) => f === "createdAt");
    expect(lowerBound).toBeLessThanOrEqual(before - THIRTY_DAYS_MS + 5);
    expect(lowerBound).toBeGreaterThanOrEqual(before - THIRTY_DAYS_MS - 5000);
    expect(capture.opts.numItems).toBe(100); // clamped to MAX_LIMIT
    expect(result).toEqual({ page: [{ _id: "1" }], isDone: false, continueCursor: "next" });
  });

  test("passes the incoming cursor through to paginate", async () => {
    const { ctx, capture } = makeListCtx({ identity: { subject: "u1" }, user: { familyId: "famA" } });
    await listActivityFeedHandler(ctx as any, { familyId: "famA", paginationOpts: { numItems: 10, cursor: "abc" } });
    expect(capture.opts.cursor).toBe("abc");
    expect(capture.opts.numItems).toBe(10);
  });
});
