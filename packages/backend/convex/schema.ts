import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  families: defineTable({
    name: v.string(),
    storageQuota: v.number(),
    storageUsed: v.number(),
    createdAt: v.number(),
  }),

  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    familyId: v.optional(v.id("families")),
    role: v.union(
      v.literal("ROLE-001"),
      v.literal("ROLE-002"),
      v.literal("ROLE-003"),
      v.literal("ROLE-004"),
      v.literal("ROLE-005"),
      v.literal("ROLE-006")
    ),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_familyId", ["familyId"]),

  notes: defineTable({
    userId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
  }).index("by_userId", ["userId"]),
});
