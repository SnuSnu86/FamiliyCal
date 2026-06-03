import { mergeAlbumFields, mergeListFields, mergeMemoFields } from "@packages/shared";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { type Auth } from "convex/server";
import { recordActivity } from "./activityFeed";
import { applyFamilyStorageDelta, assertPermanentStorageQuota } from "./storageQuotas";

async function requireUserId({ auth }: { auth: Auth }) {
  const userId = (await auth.getUserIdentity())?.subject ?? null;
  if (userId) return userId;
  throw new ConvexError({ code: "AUTH_REQUIRED", message: "Bitte melde dich an, um Memos zu synchronisieren." });
}

async function requireFamilyMember(ctx: { auth: Auth; db: any }, familyId: string) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", userId))
    .first();

  if (!user || user.familyId !== familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }

  return { userId, user };
}

function isAdminRole(role: unknown): boolean {
  return role === "ROLE-001" || role === "ROLE-002";
}

const listItemValidator = v.object({ text: v.string(), completed: v.boolean() });
const albumPhotoValidator = v.object({
  storageId: v.string(),
  fileSize: v.number(),
  uploadedAt: v.number(),
  uploadedBy: v.optional(v.string()),
});

function sumPhotoSizes(photos: Array<{ fileSize: number }>): number {
  return photos.reduce((total, photo) => total + (Number.isFinite(photo.fileSize) ? photo.fileSize : 0), 0);
}

function computePhotoSizeDelta(args: {
  previousPhotos: Array<{ storageId: string; fileSize: number }>;
  nextPhotos: Array<{ storageId: string; fileSize: number }>;
}) {
  const prevById = new Map(args.previousPhotos.map((p) => [p.storageId, p.fileSize]));
  const nextById = new Map(args.nextPhotos.map((p) => [p.storageId, p.fileSize]));

  let delta = 0;
  for (const [storageId, nextSize] of nextById) {
    const prevSize = prevById.get(storageId);
    if (prevSize === undefined) {
      delta += nextSize;
    } else {
      delta += (nextSize - prevSize);
    }
  }
  for (const [storageId, prevSize] of prevById) {
    if (!nextById.has(storageId)) {
      delta -= prevSize;
    }
  }

  return delta;
}

export const syncMemo = mutation({
  args: {
    serverId: v.optional(v.id("memos")),
    familyId: v.id("families"),
    clientId: v.string(),
    title: v.string(),
    content: v.string(),
    locallyChangedFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireFamilyMember(ctx, args.familyId);
    const now = Date.now();
    const localRecord = {
      familyId: args.familyId,
      creatorId: userId,
      clientId: args.clientId,
      title: args.title,
      content: args.content,
      updatedAt: now,
    };

    const existingByServerId = args.serverId ? await ctx.db.get(args.serverId) : null;
    const existingByClientId = await ctx.db
      .query("memos")
      .withIndex("by_familyId_and_clientId", (q: any) => q.eq("familyId", args.familyId).eq("clientId", args.clientId))
      .first();
    const existing = existingByServerId ?? existingByClientId;

    if (existing && existing.familyId !== args.familyId) {
      throw new ConvexError({ code: "MEMO_ACCESS_DENIED", message: "Dieses Memo gehört nicht zu deiner Familie." });
    }

    if (existing) {
      const { record, mergedFields } = mergeMemoFields(localRecord, existing, args.locallyChangedFields ?? []);
      const patch = {
        familyId: args.familyId,
        creatorId: existing.creatorId,
        clientId: String(record.clientId),
        title: String(record.title),
        content: String(record.content),
        updatedAt: now,
      };
      await ctx.db.patch(existing._id, patch);
      const serverRecord = await ctx.db.get(existing._id);

      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "memo_updated",
        entityType: "memo",
        entityId: String(existing._id),
        summary: "Memo aktualisiert",
        createdAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.push.sendMemoUpdatedPush, {
        familyId: args.familyId,
        creatorId: userId,
        memoId: existing._id,
        title: patch.title,
      });

      return { serverId: existing._id, serverRecord, mergedFields };
    }

    const memoId = await ctx.db.insert("memos", { ...localRecord, createdAt: now });
    const serverRecord = await ctx.db.get(memoId);

    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "memo_updated",
      entityType: "memo",
      entityId: String(memoId),
      summary: "Memo aktualisiert",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendMemoUpdatedPush, {
      familyId: args.familyId,
      creatorId: userId,
      memoId,
      title: args.title,
    });

    return {
      serverId: memoId,
      serverRecord,
      mergedFields: Object.fromEntries(Object.keys(localRecord).map((field) => [field, "local"])),
    };
  },
});

export const syncList = mutation({
  args: {
    serverId: v.optional(v.id("lists")),
    familyId: v.id("families"),
    clientId: v.string(),
    title: v.string(),
    items: v.array(listItemValidator),
    locallyChangedFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireFamilyMember(ctx, args.familyId);
    const now = Date.now();
    const localRecord = {
      familyId: args.familyId,
      creatorId: userId,
      clientId: args.clientId,
      title: args.title,
      items: args.items,
      updatedAt: now,
    };

    const existingByServerId = args.serverId ? await ctx.db.get(args.serverId) : null;
    const existingByClientId = await ctx.db
      .query("lists")
      .withIndex("by_familyId_and_clientId", (q: any) => q.eq("familyId", args.familyId).eq("clientId", args.clientId))
      .first();
    const existing = existingByServerId ?? existingByClientId;

    if (existing && existing.familyId !== args.familyId) {
      throw new ConvexError({ code: "LIST_ACCESS_DENIED", message: "Diese Liste gehört nicht zu deiner Familie." });
    }

    if (existing) {
      const { record, mergedFields } = mergeListFields(localRecord, existing, args.locallyChangedFields ?? []);
      const patch = {
        familyId: args.familyId,
        creatorId: existing.creatorId,
        clientId: String(record.clientId),
        title: String(record.title),
        items: (record.items ?? []) as Array<{ text: string; completed: boolean }>,
        updatedAt: now,
      };
      await ctx.db.patch(existing._id, patch);
      const serverRecord = await ctx.db.get(existing._id);

      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "list_updated",
        entityType: "list",
        entityId: String(existing._id),
        summary: "Liste aktualisiert",
        createdAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.push.sendListUpdatedPush, {
        familyId: args.familyId,
        creatorId: userId,
        listId: existing._id,
        title: patch.title,
      });

      return { serverId: existing._id, serverRecord, mergedFields };
    }

    const listId = await ctx.db.insert("lists", { ...localRecord, createdAt: now });
    const serverRecord = await ctx.db.get(listId);

    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "list_updated",
      entityType: "list",
      entityId: String(listId),
      summary: "Liste aktualisiert",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendListUpdatedPush, {
      familyId: args.familyId,
      creatorId: userId,
      listId,
      title: args.title,
    });

    return {
      serverId: listId,
      serverRecord,
      mergedFields: Object.fromEntries(Object.keys(localRecord).map((field) => [field, "local"])),
    };
  },
});

export const syncAlbum = mutation({
  args: {
    serverId: v.optional(v.id("albums")),
    familyId: v.id("families"),
    clientId: v.string(),
    name: v.string(),
    photos: v.array(albumPhotoValidator),
    locallyChangedFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireFamilyMember(ctx, args.familyId);
    const now = Date.now();

    if (args.photos.length > 100) {
      throw new ConvexError({ code: "ALBUM_LIMIT_EXCEEDED", message: "Dieses Album darf maximal 100 Fotos enthalten." });
    }

    const family = await ctx.db.get(args.familyId);
    if (!family) {
      throw new ConvexError({ code: "FAMILY_NOT_FOUND", message: "Familie nicht gefunden." });
    }

    const existingByServerId = args.serverId ? await ctx.db.get(args.serverId) : null;
    const existingByClientId = await ctx.db
      .query("albums")
      .withIndex("by_familyId_and_clientId", (q: any) => q.eq("familyId", args.familyId).eq("clientId", args.clientId))
      .first();
    const existing = existingByServerId ?? existingByClientId;

    if (existing && existing.familyId !== args.familyId) {
      throw new ConvexError({ code: "ALBUM_ACCESS_DENIED", message: "Dieses Album gehört nicht zu deiner Familie." });
    }

    const normalizedPhotos = args.photos.map((photo) => ({
      ...photo,
      uploadedBy: photo.uploadedBy ?? userId,
    }));

    const localRecord = {
      familyId: args.familyId,
      creatorId: userId,
      clientId: args.clientId,
      name: args.name,
      photos: normalizedPhotos,
      updatedAt: now,
    };

    const previousPhotos = (existing?.photos ?? []) as Array<{ storageId: string; fileSize: number }>;
    const delta = existing ? computePhotoSizeDelta({ previousPhotos, nextPhotos: normalizedPhotos }) : sumPhotoSizes(normalizedPhotos);
    await assertPermanentStorageQuota(ctx, { familyId: args.familyId, user, deltaBytes: delta });

    if (existing) {
      const { record, mergedFields } = mergeAlbumFields(localRecord, existing, args.locallyChangedFields ?? []);
      const patch = {
        familyId: args.familyId,
        creatorId: existing.creatorId,
        clientId: String(record.clientId),
        name: String(record.name),
        photos: (record.photos ?? []) as Array<{ storageId: string; fileSize: number; uploadedAt: number }>,
        updatedAt: now,
      };

      await ctx.db.patch(existing._id, patch);
      await applyFamilyStorageDelta(ctx, args.familyId, delta);
      const serverRecord = await ctx.db.get(existing._id);

      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "album_updated",
        entityType: "album",
        entityId: String(existing._id),
        summary: "Album aktualisiert",
        metadata: delta ? { storageDelta: delta } : undefined,
        createdAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.push.sendAlbumUpdatedPush, {
        familyId: args.familyId,
        creatorId: userId,
        albumId: existing._id,
        name: patch.name,
      });

      return { serverId: existing._id, serverRecord, mergedFields };
    }

    const albumId = await ctx.db.insert("albums", { ...localRecord, createdAt: now });
    await applyFamilyStorageDelta(ctx, args.familyId, delta);
    const serverRecord = await ctx.db.get(albumId);

    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "album_updated",
      entityType: "album",
      entityId: String(albumId),
      summary: "Album aktualisiert",
      metadata: delta ? { storageDelta: delta } : undefined,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendAlbumUpdatedPush, {
      familyId: args.familyId,
      creatorId: userId,
      albumId,
      name: args.name,
    });

    return {
      serverId: albumId,
      serverRecord,
      mergedFields: Object.fromEntries(Object.keys(localRecord).map((field) => [field, "local"])),
    };
  },
});

export const listMemos = query({
  args: { familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    return await ctx.db.query("memos").withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId)).collect();
  },
});

export const listLists = query({
  args: { familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    return await ctx.db.query("lists").withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId)).collect();
  },
});

export const listAlbums = query({
  args: { familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    return await ctx.db.query("albums").withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId)).collect();
  },
});

export const getStorageStatus = query({
  args: { familyId: v.id("families") },
  handler: async (ctx, args) => {
    const { userId } = await requireFamilyMember(ctx, args.familyId);
    const family = await ctx.db.get(args.familyId);
    if (!family) {
      throw new ConvexError({ code: "FAMILY_NOT_FOUND", message: "Familie nicht gefunden." });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q: any) => q.eq("clerkId", userId))
      .first();

    return {
      storageUsed: family.storageUsed,
      storageQuota: family.storageQuota,
      userStorageLimit: user?.storageLimit ?? null,
    };
  },
});

export const deleteMemo = mutation({
  args: { id: v.id("memos"), familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    const memo = await ctx.db.get(args.id);
    if (!memo || memo.familyId !== args.familyId) {
      throw new ConvexError({ code: "MEMO_NOT_FOUND", message: "Memo nicht gefunden." });
    }
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const deleteList = mutation({
  args: { id: v.id("lists"), familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    const list = await ctx.db.get(args.id);
    if (!list || list.familyId !== args.familyId) {
      throw new ConvexError({ code: "LIST_NOT_FOUND", message: "Liste nicht gefunden." });
    }
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const deleteAlbum = mutation({
  args: { id: v.id("albums"), familyId: v.id("families") },
  handler: async (ctx, args) => {
    const { userId } = await requireFamilyMember(ctx, args.familyId);
    const album = await ctx.db.get(args.id);
    if (!album || album.familyId !== args.familyId) {
      throw new ConvexError({ code: "ALBUM_NOT_FOUND", message: "Album nicht gefunden." });
    }

    const family = await ctx.db.get(args.familyId);
    if (family) {
      const photos = (album.photos ?? []) as Array<{ fileSize: number }>;
      await applyFamilyStorageDelta(ctx, args.familyId, -sumPhotoSizes(photos));
    }

    await ctx.db.delete(args.id);
    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "album_updated",
      entityType: "album",
      entityId: String(args.id),
      summary: "Album gelöscht",
      createdAt: Date.now(),
    });
    return args.id;
  },
});

export const updateUserStorageLimit = mutation({
  args: {
    familyId: v.id("families"),
    userId: v.id("users"),
    storageLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId: clerkId, user: admin } = await requireFamilyMember(ctx, args.familyId);

    if (!admin || admin.familyId !== args.familyId || !isAdminRole(admin.role)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Nur Eltern/Owner dürfen Unter-Quotas verwalten." });
    }

    const target = await ctx.db.get(args.userId);
    if (!target || target.familyId !== args.familyId) {
      throw new ConvexError({ code: "USER_NOT_FOUND", message: "Benutzer nicht gefunden." });
    }

    await ctx.db.patch(args.userId, { storageLimit: args.storageLimit });
    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: clerkId,
      type: "quota_updated",
      entityType: "user",
      entityId: String(args.userId),
      summary: "Unter-Quota für ein Kind geändert",
      metadata: { storageLimit: args.storageLimit ?? null },
      createdAt: Date.now(),
    });
    return await ctx.db.get(args.userId);
  },
});
