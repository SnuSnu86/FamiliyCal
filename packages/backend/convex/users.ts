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

async function findPendingInvitation(ctx: any, args: { invitationToken?: string; email: string }) {
  if (args.invitationToken?.trim()) {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q: any) => q.eq("token", args.invitationToken))
      .unique();

    if (invitation && invitation.status === "pending") {
      // Enforce email check if specified in invitation
      if (!invitation.email || invitation.email === args.email.trim().toLowerCase()) {
        return invitation;
      }
    }
  }

  const normalizedEmail = args.email.trim().toLowerCase();
  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_email", (q: any) => q.eq("email", normalizedEmail))
    .collect();

  return invitations.find((invitation: any) => invitation.status === "pending") ?? null;
}

export const upsertUserFromWebhook = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    invitationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertValidClerkUser(args);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const normalizedUser = {
      clerkId: args.clerkId,
      email: args.email.trim().toLowerCase(),
      name: args.name,
      imageUrl: args.imageUrl,
    };

    if (existingUser) {
      if (args.invitationToken && existingUser.familyId) {
        const invitation = await ctx.db
          .query("invitations")
          .withIndex("by_token", (q: any) => q.eq("token", args.invitationToken))
          .unique();
        if (invitation && invitation.familyId === existingUser.familyId) {
          await ctx.db.patch(existingUser._id, normalizedUser);
          return existingUser._id;
        }
        throw new ConvexError("User already belongs to a family");
      }
      await ctx.db.patch(existingUser._id, normalizedUser);
      return existingUser._id;
    }

    const invitation = await findPendingInvitation(ctx, {
      invitationToken: args.invitationToken,
      email: args.email,
    });

    const userId = await ctx.db.insert("users", {
      ...normalizedUser,
      familyId: invitation?.familyId,
      role: invitation?.role ?? DEFAULT_ROLE,
    });

    if (invitation) {
      await ctx.db.patch(invitation._id, { status: "accepted" });
    }

    return userId;
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

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");

    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});

export const saveE2EEKeys = mutation({
  args: {
    publicKey: v.string(),
    encryptedPrivateKey: v.string(),
    keyDerivationSalt: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");

    if (!args.publicKey.trim() || !args.encryptedPrivateKey.trim() || !args.keyDerivationSalt.trim()) {
      throw new ConvexError("E2EE key payload is incomplete");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) throw new ConvexError("Current user not found");

    await ctx.db.patch(user._id, {
      publicKey: args.publicKey,
      encryptedPrivateKey: args.encryptedPrivateKey,
      keyDerivationSalt: args.keyDerivationSalt,
    });

    return user._id;
  },
});

export const listFamilyMembers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user?.familyId) return [];

    return await ctx.db
      .query("users")
      .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
      .collect();
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
