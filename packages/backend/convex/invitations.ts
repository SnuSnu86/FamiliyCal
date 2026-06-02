import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const ADMIN_ROLES = new Set(["ROLE-001", "ROLE-002"]);
const INVITABLE_ROLES = new Set([
  "ROLE-002",
  "ROLE-003",
  "ROLE-004",
  "ROLE-005",
  "ROLE-006",
]);

async function getCurrentUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) throw new ConvexError("User profile not found");
  return user;
}

function assertAdmin(user: { role: string; familyId?: unknown }) {
  if (!ADMIN_ROLES.has(user.role) || !user.familyId) {
    throw new ConvexError("Only family owners and parents can manage invitations");
  }
}

function assertInvitableRole(role: string) {
  if (!INVITABLE_ROLES.has(role)) {
    throw new ConvexError("Invalid invitation role");
  }
}

export const createInvitation = mutation({
  args: {
    role: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertInvitableRole(args.role);
    const user = await getCurrentUser(ctx);
    assertAdmin(user);

    const token = crypto.randomUUID();
    await ctx.db.insert("invitations", {
      familyId: user.familyId,
      token,
      role: args.role as "ROLE-002" | "ROLE-003" | "ROLE-004" | "ROLE-005" | "ROLE-006",
      email: args.email?.trim().toLowerCase() || undefined,
      status: "pending",
      createdAt: Date.now(),
    });

    return { token };
  },
});

export const getInvitationByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (!invitation) return null;
    const family = await ctx.db.get(invitation.familyId);
    return { ...invitation, familyName: family?.name ?? "FamilyCal" };
  },
});

export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getCurrentUser(ctx);
    if (user.familyId) {
      throw new ConvexError("User already belongs to a family");
    }

    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (!invitation || invitation.status !== "pending") {
      throw new ConvexError("Invitation is not available");
    }

    if (invitation.email && invitation.email !== user.email.trim().toLowerCase()) {
      throw new ConvexError("Invitation was sent to a different email address");
    }

    await ctx.db.patch(user._id, {
      familyId: invitation.familyId,
      role: invitation.role,
    });
    await ctx.db.patch(invitation._id, { status: "accepted" });
    return { familyId: invitation.familyId, role: invitation.role };
  },
});

export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    assertAdmin(user);

    return await ctx.db
      .query("invitations")
      .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
  },
});

export const cancelInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getCurrentUser(ctx);
    assertAdmin(user);

    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (!invitation || invitation.familyId !== user.familyId) {
      throw new ConvexError("Invitation not found");
    }
    if (invitation.status !== "pending") {
      throw new ConvexError("Only pending invitations can be cancelled");
    }

    await ctx.db.patch(invitation._id, { status: "expired" });
    return { token };
  },
});
