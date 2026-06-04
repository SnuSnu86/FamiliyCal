import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import { mapServerKeyVerificationToLocal } from "@packages/shared";

type KeyVerificationLike = {
  _id?: string;
  serverId?: string;
  verifierId: string;
  verifiedUserId: string;
  publicKey: string;
  fingerprint: string;
};

type LocalKeyVerificationRecord = {
  serverId?: string;
  verifierId: string;
  verifiedUserId: string;
  publicKey: string;
  fingerprint: string;
  update: (writer: (record: LocalKeyVerificationRecord) => void) => Promise<LocalKeyVerificationRecord>;
  destroyPermanently: () => Promise<void>;
};

type KeyVerificationDatabase = {
  collections: {
    get: (table: string) => {
      query: (...conditions: unknown[]) => { fetch: () => Promise<LocalKeyVerificationRecord[]> };
      create: (writer: (record: LocalKeyVerificationRecord) => void) => Promise<LocalKeyVerificationRecord>;
    };
  };
  write: (writer: () => Promise<void>) => Promise<void>;
};

function assignFields(record: LocalKeyVerificationRecord, verification: KeyVerificationLike, serverId?: string) {
  if (serverId) record.serverId = serverId;
  record.verifierId = verification.verifierId;
  record.verifiedUserId = verification.verifiedUserId;
  record.publicKey = verification.publicKey;
  record.fingerprint = verification.fingerprint;
}

export async function syncVerifiedKeyToLocal({
  db,
  verification,
}: {
  db: KeyVerificationDatabase;
  verification: KeyVerificationLike | null | undefined;
}): Promise<LocalKeyVerificationRecord | null> {
  if (!verification?.verifierId || !verification?.verifiedUserId) return null;
  const serverId = verification._id ?? verification.serverId;
  const collection = db.collections.get("key_verifications");

  // Indexed lookup on the verifier/verified pair instead of fetching the whole
  // table; this pair is unique per verification record.
  const existing = (
    await collection
      .query(Q.where("verifier_id", verification.verifierId), Q.where("verified_user_id", verification.verifiedUserId))
      .fetch()
  )[0];

  let saved: LocalKeyVerificationRecord | null = null;
  await db.write(async () => {
    if (existing) {
      saved = await existing.update((record) => assignFields(record, verification, serverId));
    } else {
      saved = await collection.create((record) => assignFields(record, verification, serverId));
    }
  });
  return saved;
}

// P1: when the server reports the pair as no longer verified (key rotation /
// downgrade), drop any locally cached record so the offline badge cannot keep
// vouching for a key the server no longer matches. Without this, a stale row
// could revive the "verified" badge offline without a fresh in-person scan.
export async function pruneLocalVerification({
  db,
  verifierId,
  verifiedUserId,
}: {
  db: KeyVerificationDatabase;
  verifierId: string;
  verifiedUserId: string;
}): Promise<void> {
  if (!verifierId || !verifiedUserId) return;
  const collection = db.collections.get("key_verifications");
  const stale = await collection
    .query(Q.where("verifier_id", verifierId), Q.where("verified_user_id", verifiedUserId))
    .fetch();
  if (stale.length === 0) return;
  await db.write(async () => {
    for (const record of stale) {
      await record.destroyPermanently();
    }
  });
}

type KeyVerificationConvexClient = {
  query: (queryRef: unknown, payload: Record<string, unknown>) => Promise<KeyVerificationLike[] | null>;
};

// Pull side of the bidirectional sync (6-4 AC4): mirror the server's set of
// currently-valid verifications into the local key_verifications table and
// delete any local rows the server no longer returns (rotated key / left
// family). Server is authoritative for public_key/fingerprint here — local
// rows are a read-through cache only.
export async function reconcileKeyVerifications({
  db,
  convexClient,
  verifierId,
}: {
  db: KeyVerificationDatabase;
  convexClient: KeyVerificationConvexClient;
  verifierId: string;
}): Promise<void> {
  if (!verifierId) return;
  const serverRecords = (await convexClient.query(api.secureChats.listMyVerifications, {})) ?? [];

  const collection = db.collections.get("key_verifications");
  const localRecords = await collection
    .query(Q.where("verifier_id", verifierId))
    .fetch();
  const localByServerId = new Map(localRecords.filter((r) => r.serverId).map((r) => [r.serverId as string, r]));
  const serverIds = new Set<string>();

  await db.write(async () => {
    for (const serverRecord of serverRecords) {
      const mapped = mapServerKeyVerificationToLocal(serverRecord as any) as Record<string, unknown>;
      const serverId = mapped.server_id as string | undefined;
      if (!serverId) continue;
      serverIds.add(serverId);
      const existing = localByServerId.get(serverId);
      if (existing) {
        await existing.update((record) => assignMappedFields(record, mapped, serverId));
      } else {
        await collection.create((record) => assignMappedFields(record, mapped, serverId));
      }
    }
    for (const local of localRecords) {
      if (local.serverId && !serverIds.has(local.serverId)) {
        await local.destroyPermanently();
      }
    }
  });
}

function assignMappedFields(record: LocalKeyVerificationRecord, mapped: Record<string, unknown>, serverId: string) {
  record.serverId = serverId;
  record.verifierId = String(mapped.verifier_id ?? record.verifierId);
  record.verifiedUserId = String(mapped.verified_user_id ?? record.verifiedUserId);
  record.publicKey = String(mapped.public_key ?? record.publicKey);
  record.fingerprint = String(mapped.fingerprint ?? record.fingerprint);
}

// Background auto-sync: reconcile verifications whenever the device (re)connects,
// mirroring the startMemoListAutoSync lifecycle so the offline badge cache stays
// consistent with the server.
export function startKeyVerificationAutoSync(args: {
  db: KeyVerificationDatabase;
  convexClient: KeyVerificationConvexClient;
  verifierId: string;
}) {
  const NetInfo = require("@react-native-community/netinfo").default;
  let running = false;

  const maybeSync = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileKeyVerifications(args);
    } catch (error) {
      console.warn("Key verification reconcile failed", error);
    } finally {
      running = false;
    }
  };

  const unsubscribe = NetInfo.addEventListener((state: any) => {
    if (state?.isConnected) void maybeSync();
  });
  NetInfo.fetch().then((state: any) => {
    if (state?.isConnected) void maybeSync();
  });

  return () => unsubscribe();
}
