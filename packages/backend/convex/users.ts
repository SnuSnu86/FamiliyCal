import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_ROLE = "ROLE-003";

function assertValidClerkUser(args: { clerkId: string; email?: string }) {
  if (!args.clerkId.trim()) {
    throw new ConvexError("clerkId is required for Clerk user mapping");
  }

  if (args.email !== undefined && !args.email.trim()) {
    throw new ConvexError("email is required for Clerk user mapping");
  }
}

export const upsertUserFromWebhook = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertValidClerkUser(args);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const normalizedUser = {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      imageUrl: args.imageUrl,
    };

    if (existingUser) {
      await ctx.db.patch(existingUser._id, normalizedUser);
      return existingUser._id;
    }

    return await ctx.db.insert("users", {
      ...normalizedUser,
      role: DEFAULT_ROLE,
    });
  },
});

export const getUserByClerkId = query({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }) => {
    assertValidClerkUser({ clerkId });

    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
  },
});

export const deleteUserFromWebhook = mutation({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }) => {
    assertValidClerkUser({ clerkId });

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (!existingUser) return null;

    // Delete associated notes first
    const userNotes = await ctx.db
      .query("notes")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .collect();

    for (const note of userNotes) {
      await ctx.db.delete(note._id);
    }

    await ctx.db.delete(existingUser._id);
    return existingUser._id;
  },
});
