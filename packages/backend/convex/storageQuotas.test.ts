import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import {
  assertValidPermanentFileSize,
  assertPermanentStorageQuota,
  checkPermanentStorageUpload,
  getUserStorageUsed,
  isStorageIdReferenced,
} from "./storageQuotas";

const TWO_GB = 2 * 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// Minimal in-memory mock of the Convex query builder used by storageQuotas.
function makeQuery(rows: any[]) {
  let filtered = rows.slice();
  const builder: any = {
    withIndex: (_name: string, fn: (q: any) => any) => {
      const conds: Array<[string, unknown]> = [];
      const q: any = { eq: (field: string, value: unknown) => { conds.push([field, value]); return q; } };
      fn(q);
      filtered = filtered.filter((r) => conds.every(([f, v]) => r[f] === v));
      return builder;
    },
    filter: (fn: (q: any) => any) => {
      const q: any = {
        field: (name: string) => ({ __field: name }),
        eq: (a: any, b: any) => (r: any) => {
          const av = a && a.__field ? r[a.__field] : a;
          const bv = b && b.__field ? r[b.__field] : b;
          return av === bv;
        },
      };
      const pred = fn(q);
      filtered = filtered.filter(pred);
      return builder;
    },
    collect: async () => filtered.slice(),
    first: async () => filtered[0] ?? null,
  };
  return builder;
}

function makeCtx(opts: {
  chatMessages?: any[];
  albums?: any[];
  families?: Record<string, any>;
  storage?: Record<string, any>;
} = {}) {
  const tables: Record<string, any[]> = {
    chatMessages: opts.chatMessages ?? [],
    albums: opts.albums ?? [],
  };
  const families = opts.families ?? {};
  const storage = opts.storage ?? {};
  const storageDeletes: string[] = [];

  const ctx = {
    db: {
      query: (table: string) => makeQuery(tables[table] ?? []),
      get: async (id: string) => families[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        families[id] = { ...families[id], ...patch };
      },
      system: { get: async (id: string) => storage[id] ?? null },
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
        delete storage[id];
      },
    },
  };

  return { ctx, families, storage, storageDeletes };
}

async function expectConvexError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ConvexError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<any>).data.code).toBe(code);
  }
}

describe("assertValidPermanentFileSize", () => {
  test("accepts zero and positive finite sizes", () => {
    expect(() => assertValidPermanentFileSize(0)).not.toThrow();
    expect(() => assertValidPermanentFileSize(1234)).not.toThrow();
  });

  test("rejects negative, NaN and infinite sizes", () => {
    expect(() => assertValidPermanentFileSize(-1)).toThrow(ConvexError);
    expect(() => assertValidPermanentFileSize(Number.NaN)).toThrow(ConvexError);
    expect(() => assertValidPermanentFileSize(Number.POSITIVE_INFINITY)).toThrow(ConvexError);
  });
});

describe("getUserStorageUsed", () => {
  test("sums a user's non-deleted chat attachments and excludes deleted ones", async () => {
    const { ctx } = makeCtx({
      chatMessages: [
        { senderId: "u1", fileSize: 5 * MB },
        { senderId: "u1", fileSize: 3 * MB, deletedAt: 123 },
        { senderId: "u2", fileSize: 9 * MB },
      ],
    });
    expect(await getUserStorageUsed(ctx as any, "u1", "famA")).toBe(5 * MB);
  });

  test("only counts album photos within the requested family and attributes by uploader", async () => {
    const { ctx } = makeCtx({
      albums: [
        { familyId: "famA", creatorId: "u1", photos: [
          { storageId: "a", fileSize: 2 * MB, uploadedBy: "u1" },
          { storageId: "b", fileSize: 4 * MB, uploadedBy: "u2" },
          { storageId: "c", fileSize: 1 * MB }, // legacy -> falls back to creator u1
        ] },
        { familyId: "famB", creatorId: "u1", photos: [
          { storageId: "x", fileSize: 8 * MB, uploadedBy: "u1" }, // other family, excluded
        ] },
      ],
    });
    expect(await getUserStorageUsed(ctx as any, "u1", "famA")).toBe(3 * MB);
  });
});

describe("isStorageIdReferenced", () => {
  test("detects references in chat messages and album photos", async () => {
    const { ctx } = makeCtx({
      chatMessages: [{ storageId: "chat-1" }],
      albums: [{ photos: [{ storageId: "album-1" }] }],
    });
    expect(await isStorageIdReferenced(ctx as any, "chat-1")).toBe(true);
    expect(await isStorageIdReferenced(ctx as any, "album-1")).toBe(true);
    expect(await isStorageIdReferenced(ctx as any, "missing")).toBe(false);
  });
});

describe("assertPermanentStorageQuota", () => {
  const user = { clerkId: "u1" };

  test("returns early for non-positive deltas (e.g. temporary Whisper uploads)", async () => {
    const { ctx } = makeCtx({ families: { famA: { storageUsed: TWO_GB, storageQuota: TWO_GB } } });
    await expect(assertPermanentStorageQuota(ctx as any, { familyId: "famA", user, deltaBytes: 0 })).resolves.toBeUndefined();
  });

  test("allows an upload while the family is at 89%", async () => {
    const used = Math.floor(TWO_GB * 0.89);
    const { ctx } = makeCtx({ families: { famA: { storageUsed: used, storageQuota: TWO_GB } } });
    await expect(
      assertPermanentStorageQuota(ctx as any, { familyId: "famA", user, deltaBytes: 1 * MB }),
    ).resolves.toBeUndefined();
  });

  test("blocks an upload that would push the family over 100%", async () => {
    const { ctx } = makeCtx({ families: { famA: { storageUsed: TWO_GB, storageQuota: TWO_GB } } });
    await expectConvexError(
      assertPermanentStorageQuota(ctx as any, { familyId: "famA", user, deltaBytes: 1 }),
      "STORAGE_LIMIT_EXCEEDED",
    );
  });

  test("blocks a child once their own usage plus the new file exceeds their personal limit", async () => {
    const childLimit = 10 * MB;
    const { ctx } = makeCtx({
      families: { famA: { storageUsed: 100 * MB, storageQuota: TWO_GB } },
      chatMessages: [{ senderId: "child", fileSize: 9 * MB }],
    });
    await expectConvexError(
      assertPermanentStorageQuota(ctx as any, {
        familyId: "famA",
        user: { clerkId: "child", storageLimit: childLimit },
        deltaBytes: 2 * MB,
      }),
      "USER_LIMIT_EXCEEDED",
    );
  });

  test("allows a child whose usage plus the new file stays within their limit", async () => {
    const childLimit = 10 * MB;
    const { ctx } = makeCtx({
      families: { famA: { storageUsed: 100 * MB, storageQuota: TWO_GB } },
      chatMessages: [{ senderId: "child", fileSize: 5 * MB }],
    });
    await expect(
      assertPermanentStorageQuota(ctx as any, {
        familyId: "famA",
        user: { clerkId: "child", storageLimit: childLimit },
        deltaBytes: 4 * MB,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("checkPermanentStorageUpload", () => {
  const user = { clerkId: "u1" };

  test("rejects and cleans up uploads whose size cannot be verified", async () => {
    const { ctx, storageDeletes } = makeCtx({
      families: { famA: { storageUsed: 0, storageQuota: TWO_GB } },
      storage: {}, // no metadata for "ghost"
    });
    await expectConvexError(
      checkPermanentStorageUpload(ctx as any, user, "famA", "ghost", 5 * MB),
      "INVALID_FILE_SIZE",
    );
    expect(storageDeletes).toContain("ghost");
  });

  test("uses server metadata (not the client size) and books it against the family", async () => {
    const { ctx, families } = makeCtx({
      families: { famA: { storageUsed: 0, storageQuota: TWO_GB } },
      storage: { "file-1": { size: 7 * MB } },
    });
    // Client lies with size 1, the server still books the real 7 MB.
    await checkPermanentStorageUpload(ctx as any, user, "famA", "file-1", 1);
    expect(families.famA.storageUsed).toBe(7 * MB);
  });

  test("does not double-book a storageId that is already referenced", async () => {
    const { ctx, families } = makeCtx({
      families: { famA: { storageUsed: 7 * MB, storageQuota: TWO_GB } },
      chatMessages: [{ storageId: "file-1" }],
      storage: { "file-1": { size: 7 * MB } },
    });
    await checkPermanentStorageUpload(ctx as any, user, "famA", "file-1", 7 * MB);
    expect(families.famA.storageUsed).toBe(7 * MB); // unchanged
  });
});
