import { describe, expect, jest, test } from "@jest/globals";
import { ConvexError } from "convex/values";

// computeKeyFingerprint lazily dynamic-imports @noble/hashes (ESM-only), which
// ts-jest's CJS runtime cannot load. Mock just that function with a deterministic
// stub — the real publicKeysMatch (canonical key comparison) is preserved — so
// these stay pure behavioral tests without pulling in the ESM dependency.
const fp = (input: string) => `fp:${input}`;
jest.mock("@packages/shared", () => {
  const actual = jest.requireActual("@packages/shared") as Record<string, unknown>;
  return { ...actual, computeKeyFingerprint: async (input: string) => `fp:${input}` };
});

import {
  getVerificationStatusHandler,
  listMyVerificationsHandler,
  verifyParticipantKeyHandler,
} from "./secureChats";

// Behavioral tests for the key-verification API. We exercise the exported
// handlers directly against a small in-memory fake ctx (the same pattern used by
// activityFeed.test.ts), so assertions cover real persistence, MitM rejection,
// the activity-feed side effect and the TOFU downgrade — not source strings.

const FAMILY = "famA";
// Minimal valid EC/JWK-shaped public keys (canonicalizePublicKey only needs
// kty/crv/x/y). Distinct x ⇒ distinct canonical key ⇒ distinct identity.
const KEY_A = JSON.stringify({ kty: "EC", crv: "P-256", x: "AAAA", y: "BBBB" });
const KEY_B = JSON.stringify({ kty: "EC", crv: "P-256", x: "CCCC", y: "DDDD" });

type Row = Record<string, any>;

function makeCtx(seed: { identity: string | null; users: Row[]; keyVerifications?: Row[] }) {
  const tables: Record<string, Row[]> = {
    users: seed.users.map((u) => ({ ...u })),
    keyVerifications: (seed.keyVerifications ?? []).map((r) => ({ ...r })),
    activityFeedEntries: [],
  };
  let counter = 1;
  const allRows = () => Object.values(tables).flat();

  const query = (table: string) => ({
    withIndex: (_name: string, fn: (q: any) => any) => {
      const preds: Array<[string, unknown]> = [];
      const q: any = { eq: (f: string, v: unknown) => { preds.push([f, v]); return q; }, gte: () => q };
      fn(q);
      const rows = (tables[table] ?? []).filter((row) => preds.every(([f, v]) => row[f] === v));
      return {
        unique: async () => (rows.length > 1 ? (() => { throw new Error("not unique"); })() : rows[0] ?? null),
        first: async () => rows[0] ?? null,
        take: async (n: number) => rows.slice(0, n),
      };
    },
  });

  const ctx = {
    auth: { getUserIdentity: async () => (seed.identity ? { subject: seed.identity } : null) },
    db: {
      query,
      insert: async (table: string, value: Row) => {
        const _id = `${table}_${counter++}`;
        tables[table].push({ _id, ...value });
        return _id;
      },
      patch: async (id: string, value: Row) => { const row = allRows().find((r) => r._id === id); if (row) Object.assign(row, value); },
      get: async (id: string) => allRows().find((r) => r._id === id) ?? null,
    },
  };
  return { ctx, tables };
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

describe("verifyParticipantKeyHandler", () => {
  const verifier = { clerkId: "u1", familyId: FAMILY, name: "Alice" };
  const verified = { clerkId: "u2", familyId: FAMILY, name: "Bob", publicKey: KEY_A };

  test("persists a verification and writes an activity-feed entry", async () => {
    const fingerprint = fp(KEY_A);
    const { ctx, tables } = makeCtx({ identity: "u1", users: [verifier, verified] });

    const record = await verifyParticipantKeyHandler(ctx as any, {
      verifiedUserId: "u2",
      publicKey: KEY_A,
      fingerprint,
    });

    expect(record).toMatchObject({ verifierId: "u1", verifiedUserId: "u2", publicKey: KEY_A, fingerprint });
    expect(tables.keyVerifications).toHaveLength(1);
    expect(tables.activityFeedEntries).toHaveLength(1);
    expect(tables.activityFeedEntries[0]).toMatchObject({ type: "key_verified", entityId: "u2" });
  });

  test("rejects verifying your own key", async () => {
    const { ctx } = makeCtx({ identity: "u1", users: [verifier, verified] });
    await expectConvexError(
      verifyParticipantKeyHandler(ctx as any, { verifiedUserId: "u1", publicKey: KEY_A, fingerprint: "x" }),
      "SELF_VERIFICATION_DENIED",
    );
  });

  test("rejects a key that does not match the current server key (MitM)", async () => {
    const fingerprint = fp(KEY_B);
    const { ctx } = makeCtx({ identity: "u1", users: [verifier, verified] });
    await expectConvexError(
      verifyParticipantKeyHandler(ctx as any, { verifiedUserId: "u2", publicKey: KEY_B, fingerprint }),
      "KEY_VERIFICATION_MISMATCH",
    );
  });

  test("rejects a fingerprint inconsistent with the submitted key", async () => {
    const { ctx } = makeCtx({ identity: "u1", users: [verifier, verified] });
    await expectConvexError(
      verifyParticipantKeyHandler(ctx as any, { verifiedUserId: "u2", publicKey: KEY_A, fingerprint: "deadbeef" }),
      "KEY_VERIFICATION_MISMATCH",
    );
  });

  test("rejects a verified user from another family", async () => {
    const outsider = { clerkId: "u2", familyId: "famB", name: "Bob", publicKey: KEY_A };
    const { ctx } = makeCtx({ identity: "u1", users: [verifier, outsider] });
    const fingerprint = fp(KEY_A);
    await expectConvexError(
      verifyParticipantKeyHandler(ctx as any, { verifiedUserId: "u2", publicKey: KEY_A, fingerprint }),
      "FAMILY_ACCESS_DENIED",
    );
  });

  test("updates the existing record instead of inserting a duplicate", async () => {
    const fingerprint = fp(KEY_A);
    const { ctx, tables } = makeCtx({
      identity: "u1",
      users: [verifier, verified],
      keyVerifications: [{ _id: "kv_existing", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u2", publicKey: "old", fingerprint: "old" }],
    });

    await verifyParticipantKeyHandler(ctx as any, { verifiedUserId: "u2", publicKey: KEY_A, fingerprint });

    expect(tables.keyVerifications).toHaveLength(1);
    expect(tables.keyVerifications[0]).toMatchObject({ _id: "kv_existing", publicKey: KEY_A, fingerprint });
  });
});

describe("getVerificationStatusHandler", () => {
  const verifier = { clerkId: "u1", familyId: FAMILY };

  test("returns the verification while the key still matches", async () => {
    const { ctx } = makeCtx({
      identity: "u1",
      users: [verifier, { clerkId: "u2", familyId: FAMILY, publicKey: KEY_A }],
      keyVerifications: [{ _id: "kv1", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u2", publicKey: KEY_A, fingerprint: "f" }],
    });
    const result = await getVerificationStatusHandler(ctx as any, { verifiedUserId: "u2" });
    expect(result).toMatchObject({ _id: "kv1" });
  });

  test("downgrades to null after the verified user rotates their key (TOFU)", async () => {
    const { ctx } = makeCtx({
      identity: "u1",
      users: [verifier, { clerkId: "u2", familyId: FAMILY, publicKey: KEY_B }],
      keyVerifications: [{ _id: "kv1", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u2", publicKey: KEY_A, fingerprint: "f" }],
    });
    expect(await getVerificationStatusHandler(ctx as any, { verifiedUserId: "u2" })).toBeNull();
  });

  test("downgrades to null when the verified user left the family", async () => {
    const { ctx } = makeCtx({
      identity: "u1",
      users: [verifier, { clerkId: "u2", familyId: "famB", publicKey: KEY_A }],
      keyVerifications: [{ _id: "kv1", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u2", publicKey: KEY_A, fingerprint: "f" }],
    });
    expect(await getVerificationStatusHandler(ctx as any, { verifiedUserId: "u2" })).toBeNull();
  });
});

describe("listMyVerificationsHandler", () => {
  test("returns only currently-valid verifications (rotated/left-family excluded)", async () => {
    const { ctx } = makeCtx({
      identity: "u1",
      users: [
        { clerkId: "u1", familyId: FAMILY },
        { clerkId: "u2", familyId: FAMILY, publicKey: KEY_A }, // still valid
        { clerkId: "u3", familyId: FAMILY, publicKey: KEY_B }, // rotated away from stored KEY_A
        { clerkId: "u4", familyId: "famB", publicKey: KEY_A }, // left family
      ],
      keyVerifications: [
        { _id: "kvA", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u2", publicKey: KEY_A, fingerprint: "f" },
        { _id: "kvB", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u3", publicKey: KEY_A, fingerprint: "f" },
        { _id: "kvC", familyId: FAMILY, verifierId: "u1", verifiedUserId: "u4", publicKey: KEY_A, fingerprint: "f" },
      ],
    });
    const result = await listMyVerificationsHandler(ctx as any);
    expect(result.map((r: any) => r._id)).toEqual(["kvA"]);
  });
});
