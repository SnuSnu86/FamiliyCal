import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const FAMILY_OWNER_ROLE = "ROLE-001";
const DEFAULT_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError("Benutzer ist nicht authentifiziert");
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new ConvexError("Familienname ist erforderlich");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      throw new ConvexError("Benutzerprofil wurde nicht gefunden");
    }

    if (user.familyId) {
      throw new ConvexError("Benutzer gehört bereits einer Familie an");
    }

    const familyId = await ctx.db.insert("families", {
      name: trimmedName,
      storageQuota: DEFAULT_STORAGE_QUOTA_BYTES,
      storageUsed: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(user._id, {
      familyId,
      role: FAMILY_OWNER_ROLE,
    });

    return familyId;
  },
});

export const getFamily = query({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, { familyId }) => {
    return await ctx.db.get(familyId);
  },
});
