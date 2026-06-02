import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { type Auth } from "convex/server";

async function requireFamilyMember(ctx: { auth: Auth; db: any }, familyId: string) {
  const clerkId = (await ctx.auth.getUserIdentity())?.subject ?? null;
  if (!clerkId) {
    throw new ConvexError({ code: "AUTH_REQUIRED", message: "Bitte melde dich an, um Ressourcen zu verwalten." });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", clerkId))
    .first();

  if (!user || user.familyId !== familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }

  return user;
}

const virtualMemberFields = {
  familyId: v.id("families"),
  name: v.string(),
  type: v.string(),
  color: v.optional(v.string()),
};

export const create = mutation({
  args: virtualMemberFields,
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    const now = Date.now();
    return await ctx.db.insert("virtualMembers", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listByFamily = query({
  args: { familyId: v.id("families") },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    return await ctx.db
      .query("virtualMembers")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("virtualMembers"),
    familyId: v.id("families"),
    name: v.optional(v.string()),
    type: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFamilyMember(ctx, args.familyId);
    const member = await ctx.db.get(args.id);
    if (!member || member.familyId !== args.familyId) {
      throw new ConvexError({ code: "RESOURCE_NOT_FOUND", message: "Die Ressource gehört nicht zu deiner Familie." });
    }

    const { id: _id, familyId: _familyId, ...patch } = args;
    await ctx.db.patch(args.id, { ...patch, updatedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});
