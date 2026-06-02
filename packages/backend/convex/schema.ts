import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  families: defineTable({
    name: v.string(),
    storageQuota: v.number(),
    storageUsed: v.number(),
    createdAt: v.number(),
  }),

  invitations: defineTable({
    familyId: v.id("families"),
    token: v.string(),
    role: v.union(
      v.literal("ROLE-002"),
      v.literal("ROLE-003"),
      v.literal("ROLE-004"),
      v.literal("ROLE-005"),
      v.literal("ROLE-006")
    ),
    email: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired")
    ),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_familyId", ["familyId"])
    .index("by_email", ["email"]),

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

  calendarEvents: defineTable({
    familyId: v.id("families"),
    creatorId: v.string(),
    clientId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    allDay: v.boolean(),
    rrule: v.optional(v.string()),
    timezoneId: v.optional(v.string()),
    floatingTime: v.boolean(),
    vetoStatus: v.optional(v.string()),
    vetoReason: v.optional(v.string()),
    vetoChildId: v.optional(v.string()),
    status: v.optional(v.string()),
    resourceId: v.optional(v.id("virtualMembers")),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_familyId", ["familyId"])
    .index("by_clientId", ["clientId"])
    .index("by_resourceId", ["resourceId"])
    .index("by_vetoChildId", ["vetoChildId"]),

  virtualMembers: defineTable({
    familyId: v.id("families"),
    name: v.string(),
    type: v.string(),
    color: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_familyId", ["familyId"])
    .index("by_familyId_type", ["familyId", "type"]),

  chatThreads: defineTable({
    familyId: v.id("families"),
    type: v.union(v.literal("group"), v.literal("direct"), v.literal("event")),
    title: v.string(),
    participantIds: v.array(v.string()),
    directKey: v.optional(v.string()),
    calendarEventId: v.optional(v.id("calendarEvents")),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessagePreview: v.optional(v.string()),
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_familyId", ["familyId"])
    .index("by_familyId_type", ["familyId", "type"])
    .index("by_familyId_directKey", ["familyId", "directKey"])
    .index("by_familyId_calendarEventId", ["familyId", "calendarEventId"]),

  chatMessages: defineTable({
    threadId: v.id("chatThreads"),
    familyId: v.id("families"),
    senderId: v.string(),
    body: v.string(),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_threadId_createdAt", ["threadId", "createdAt"]),

  pushTokens: defineTable({
    userId: v.string(),
    familyId: v.id("families"),
    expoPushToken: v.string(),
    updatedAt: v.number(),
  })
    .index("by_familyId", ["familyId"])
    .index("by_userId", ["userId"]),
});
