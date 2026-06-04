import { ConvexError } from "convex/values";

function quotaError(code: string, message: string) {
  return new ConvexError({ code, message });
}

export function assertValidPermanentFileSize(size: number) {
  if (typeof size !== "number" || size < 0 || !Number.isFinite(size)) {
    throw quotaError("INVALID_FILE_SIZE", "Ungültige Dateigröße.");
  }
}

// Resolve the authoritative, server-side byte size of a stored file. A
// client-supplied size must never be trusted: it is the source of a quota
// bypass. Returns null when the file/metadata cannot be verified.
async function resolveStoredFileSize(ctx: { db: any }, storageId: string): Promise<number | null> {
  const metadata = await ctx.db.system.get(storageId);
  if (!metadata || typeof metadata.size !== "number" || !Number.isFinite(metadata.size)) {
    return null;
  }
  return metadata.size;
}

export async function getUserStorageUsed(
  ctx: { db: any },
  userId: string,
  familyId: any,
): Promise<number> {
  let total = 0;

  const chatMessages = await ctx.db
    .query("chatMessages")
    .withIndex("by_senderId", (q: any) => q.eq("senderId", userId))
    .collect();
  for (const msg of chatMessages) {
    if (!msg.deletedAt && msg.fileSize) total += msg.fileSize;
  }

  // Only albums within the same family count toward this user's usage. A photo
  // is attributed to its uploader, falling back to the album creator for legacy
  // photos that predate per-photo uploader tracking.
  const familyAlbums = await ctx.db
    .query("albums")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", familyId))
    .collect();
  for (const album of familyAlbums) {
    const photos = (album.photos ?? []) as Array<{ fileSize: number; uploadedBy?: string }>;
    for (const photo of photos) {
      const owner = photo.uploadedBy ?? album.creatorId;
      if (owner === userId && photo.fileSize) total += photo.fileSize;
    }
  }

  return total;
}

export async function isStorageIdReferenced(ctx: { db: any }, storageId: string): Promise<boolean> {
  const msg = await ctx.db
    .query("chatMessages")
    .filter((q: any) => q.eq(q.field("storageId"), storageId))
    .first();
  if (msg) return true;

  const allAlbums = await ctx.db.query("albums").collect();
  for (const album of allAlbums) {
    const photos = (album.photos ?? []) as Array<{ storageId: string }>;
    if (photos.some((photo) => photo.storageId === storageId)) return true;
  }

  return false;
}

export async function assertPermanentStorageQuota(ctx: { db: any }, args: {
  familyId: any;
  user: { clerkId: string; storageLimit?: number };
  deltaBytes: number;
}) {
  assertValidPermanentFileSize(args.deltaBytes);
  if (args.deltaBytes <= 0) return;

  const family = await ctx.db.get(args.familyId);
  if (!family) {
    throw quotaError("FAMILY_NOT_FOUND", "Familie nicht gefunden.");
  }

  if (Number(family.storageUsed) + args.deltaBytes > Number(family.storageQuota)) {
    throw quotaError("STORAGE_LIMIT_EXCEEDED", "Das Familien-Speicherlimit ist erreicht. Medien-Uploads sind blockiert.");
  }

  const userLimit = args.user.storageLimit;
  if (typeof userLimit === "number" && Number.isFinite(userLimit)) {
    const userStorageUsed = await getUserStorageUsed(ctx, args.user.clerkId, args.familyId);
    if (userStorageUsed + args.deltaBytes > userLimit) {
      throw quotaError("USER_LIMIT_EXCEEDED", "Dein persönliches Speicherlimit ist erreicht.");
    }
  }
}

export async function applyFamilyStorageDelta(ctx: { db: any }, familyId: any, deltaBytes: number) {
  const family = await ctx.db.get(familyId);
  if (!family) {
    throw quotaError("FAMILY_NOT_FOUND", "Familie nicht gefunden.");
  }
  await ctx.db.patch(familyId, {
    storageUsed: Math.max(0, Number(family.storageUsed) + deltaBytes),
  });
}

export async function checkPermanentStorageUpload(
  ctx: { db: any; storage: any },
  user: { clerkId: string; storageLimit?: number },
  familyId: any,
  storageId?: string,
  // The client-supplied fileSize is intentionally ignored for accounting; the
  // server-side metadata is the source of truth. Kept for signature stability.
  _fileSize?: number,
) {
  if (!storageId) return;

  // Already accounted for by another message/album: do not re-check or double-book.
  if (await isStorageIdReferenced(ctx, storageId)) return;

  // The stored file's real size is authoritative. A missing/invalid size means
  // we cannot account for the upload, so reject it instead of letting it slip
  // past the quota with a zero/forged size.
  const size = await resolveStoredFileSize(ctx, storageId);
  if (size === null || size <= 0) {
    try {
      await ctx.storage.delete(storageId);
    } catch {
      // Best-effort cleanup only.
    }
    throw quotaError("INVALID_FILE_SIZE", "Die Dateigröße konnte nicht verifiziert werden.");
  }

  try {
    await assertPermanentStorageQuota(ctx, { familyId, user, deltaBytes: size });
  } catch (error) {
    try {
      if (!(await isStorageIdReferenced(ctx, storageId))) {
        await ctx.storage.delete(storageId);
      }
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }

  await applyFamilyStorageDelta(ctx, familyId, size);
}
