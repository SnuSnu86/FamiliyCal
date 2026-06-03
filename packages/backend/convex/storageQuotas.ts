import { ConvexError } from "convex/values";

function quotaError(code: string, message: string) {
  return new ConvexError({ code, message });
}

export function assertValidPermanentFileSize(size: number) {
  if (typeof size !== "number" || size < 0 || !Number.isFinite(size)) {
    throw quotaError("INVALID_FILE_SIZE", "Ungültige Dateigröße.");
  }
}

export async function getUserStorageUsed(ctx: { db: any }, userId: string): Promise<number> {
  let total = 0;

  const chatMessages = await ctx.db
    .query("chatMessages")
    .withIndex("by_senderId", (q: any) => q.eq("senderId", userId))
    .collect();
  for (const msg of chatMessages) {
    if (!msg.deletedAt && msg.fileSize) total += msg.fileSize;
  }

  const ownedAlbums = await ctx.db
    .query("albums")
    .withIndex("by_creatorId", (q: any) => q.eq("creatorId", userId))
    .collect();
  for (const album of ownedAlbums) {
    const photos = (album.photos ?? []) as Array<{ fileSize: number; uploadedBy?: string }>;
    for (const photo of photos) {
      if (!photo.uploadedBy && photo.fileSize) total += photo.fileSize;
    }
  }

  const familyAlbums = await ctx.db.query("albums").collect();
  for (const album of familyAlbums) {
    const photos = (album.photos ?? []) as Array<{ fileSize: number; uploadedBy?: string }>;
    for (const photo of photos) {
      if (photo.uploadedBy === userId && photo.fileSize) total += photo.fileSize;
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
    const userStorageUsed = await getUserStorageUsed(ctx, args.user.clerkId);
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
  fileSize?: number,
) {
  if (!storageId) return;
  let size = fileSize ?? 0;
  if (size <= 0) {
    const metadata = await ctx.storage.getMetadata(storageId);
    if (metadata) {
      size = metadata.size;
    }
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
