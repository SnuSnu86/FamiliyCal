import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { type Auth } from "convex/server";

const GROUP_THREAD_TITLE = "Familienchat";
const MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 2000;

function appError(code: string, message: string) {
  return new ConvexError({ code, message });
}

async function requireUser(ctx: { auth: Auth; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("AUTH_REQUIRED", "Bitte melde dich an, um Chats zu nutzen.");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user?.familyId) {
    throw appError("FAMILY_REQUIRED", "Du bist noch keiner Familie zugeordnet.");
  }

  return { userId: identity.subject, user, familyId: user.familyId };
}

function createDirectKey(userA: string, userB: string) {
  return [userA, userB].sort((a, b) => a.localeCompare(b)).join(":");
}

function assertThreadParticipant(thread: { type: "group" | "direct" | "event"; participantIds: string[] }, userId: string) {
  if (thread.type === "group" || thread.type === "event") return;
  if (!thread.participantIds.includes(userId)) {
    throw appError("THREAD_ACCESS_DENIED", "Du bist kein Teilnehmer dieses Chats.");
  }
}

async function getThreadForUser(ctx: { auth: Auth; db: any }, threadId: any) {
  const { userId, familyId } = await requireUser(ctx);
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.familyId !== familyId) {
    throw appError("THREAD_ACCESS_DENIED", "Dieser Chat gehört nicht zu deiner Familie.");
  }

  assertThreadParticipant(thread, userId);
  return { thread, userId, familyId };
}

async function requireCalendarEventForUser(ctx: { auth: Auth; db: any }, calendarEventId: any) {
  const { userId, familyId } = await requireUser(ctx);
  const event = await ctx.db.get(calendarEventId);

  if (!event || event.familyId !== familyId) {
    throw appError("EVENT_ACCESS_DENIED", "Dieser Termin gehört nicht zu deiner Familie.");
  }

  return { event, userId, familyId };
}

async function listFamilyMemberIds(ctx: { db: any }, familyId: any) {
  const members = await ctx.db
    .query("users")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", familyId))
    .collect();

  return members.map((member: any) => member.clerkId);
}

async function ensureEventThreadRecord(ctx: { auth: Auth; db: any }, calendarEventId: any) {
  const { event, userId, familyId } = await requireCalendarEventForUser(ctx, calendarEventId);
  const existing = await ctx.db
    .query("chatThreads")
    .withIndex("by_familyId_calendarEventId", (q: any) => q.eq("familyId", familyId).eq("calendarEventId", calendarEventId))
    .first();

  if (existing) return existing;

  const now = Date.now();
  const threadId = await ctx.db.insert("chatThreads", {
    familyId,
    type: "event",
    title: `Kommentare: ${event.title}`,
    participantIds: await listFamilyMemberIds(ctx, familyId),
    calendarEventId,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  return await ctx.db.get(threadId);
}

async function ensureGroupThreadRecord(ctx: { auth: Auth; db: any }) {
  const { userId, familyId } = await requireUser(ctx);
  const existing = await ctx.db
    .query("chatThreads")
    .withIndex("by_familyId_type", (q: any) => q.eq("familyId", familyId).eq("type", "group"))
    .first();

  if (existing) return existing;

  const members = await ctx.db
    .query("users")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", familyId))
    .collect();
  const now = Date.now();
  const threadId = await ctx.db.insert("chatThreads", {
    familyId,
    type: "group",
    title: GROUP_THREAD_TITLE,
    participantIds: members.map((member: any) => member.clerkId),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  return await ctx.db.get(threadId);
}

export const ensureFamilyGroupThread = mutation({
  args: {},
  handler: async (ctx) => {
    return await ensureGroupThreadRecord(ctx);
  },
});

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const { userId, familyId } = await requireUser(ctx);
    const threads = await ctx.db
      .query("chatThreads")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .collect();

    return threads
      .filter((thread) => thread.type === "group" || thread.participantIds.includes(userId))
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt));
  },
});

export const getOrCreateDirectThread = mutation({
  args: { targetUserId: v.string() },
  handler: async (ctx, args) => {
    const { userId, familyId } = await requireUser(ctx);
    if (args.targetUserId === userId) {
      throw appError("SELF_CHAT_DENIED", "Für dich selbst nutze bitte den Familienchat.");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.targetUserId))
      .unique();

    if (!targetUser || targetUser.familyId !== familyId) {
      throw appError("FAMILY_ACCESS_DENIED", "Dieses Familienmitglied ist nicht verfügbar.");
    }

    const directKey = createDirectKey(userId, args.targetUserId);
    const existing = await ctx.db
      .query("chatThreads")
      .withIndex("by_familyId_directKey", (q) => q.eq("familyId", familyId).eq("directKey", directKey))
      .first();

    if (existing) return existing;

    const now = Date.now();
    const threadId = await ctx.db.insert("chatThreads", {
      familyId,
      type: "direct",
      title: targetUser.name ?? targetUser.email ?? "Direktchat",
      participantIds: [userId, args.targetUserId].sort((a, b) => a.localeCompare(b)),
      directKey,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return await ctx.db.get(threadId);
  },
});

export const ensureEventThread = mutation({
  args: { calendarEventId: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    return await ensureEventThreadRecord(ctx, args.calendarEventId);
  },
});

export const getEventThread = query({
  args: { calendarEventId: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    const { familyId } = await requireCalendarEventForUser(ctx, args.calendarEventId);
    return await ctx.db
      .query("chatThreads")
      .withIndex("by_familyId_calendarEventId", (q) => q.eq("familyId", familyId).eq("calendarEventId", args.calendarEventId))
      .first();
  },
});

export const listEventMessages = query({
  args: { calendarEventId: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    const { familyId } = await requireCalendarEventForUser(ctx, args.calendarEventId);
    const thread = await ctx.db
      .query("chatThreads")
      .withIndex("by_familyId_calendarEventId", (q) => q.eq("familyId", familyId).eq("calendarEventId", args.calendarEventId))
      .first();

    if (!thread) return [];
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(MESSAGE_LIMIT);

    return messages.reverse();
  },
});

export const listMessages = query({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    await getThreadForUser(ctx, args.threadId);
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(MESSAGE_LIMIT);

    return messages.reverse();
  },
});

export const sendEventComment = mutation({
  args: { calendarEventId: v.id("calendarEvents"), body: v.string() },
  handler: async (ctx, args) => {
    const thread = await ensureEventThreadRecord(ctx, args.calendarEventId);
    if (!thread) throw appError("THREAD_CREATE_FAILED", "Der Kommentar-Thread konnte nicht erstellt werden.");

    const { userId, familyId } = await requireUser(ctx);
    if (thread.familyId !== familyId || thread.calendarEventId !== args.calendarEventId) {
      throw appError("THREAD_ACCESS_DENIED", "Dieser Kommentarbereich gehört nicht zu deinem Termin.");
    }

    const body = args.body.trim();
    if (!body) throw appError("EMPTY_MESSAGE", "Bitte schreibe einen Kommentar, bevor du sendest.");
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw appError("MESSAGE_TOO_LONG", "Der Kommentar ist zu lang. Bitte kürze ihn etwas.");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("chatMessages", {
      threadId: thread._id,
      familyId,
      senderId: userId,
      body,
      createdAt: now,
    });

    await ctx.db.patch(thread._id, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: body.length > 80 ? `${body.slice(0, 77)}…` : body,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendChatMessagePush, {
      familyId,
      senderId: userId,
      threadId: thread._id,
      messageId,
      participantIds: await listFamilyMemberIds(ctx, familyId),
      preview: body,
    });

    return await ctx.db.get(messageId);
  },
});

export const sendMessage = mutation({
  args: { threadId: v.id("chatThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const { thread, userId, familyId } = await getThreadForUser(ctx, args.threadId);
    const body = args.body.trim();
    if (!body) throw appError("EMPTY_MESSAGE", "Bitte schreibe eine Nachricht, bevor du sendest.");
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw appError("MESSAGE_TOO_LONG", "Die Nachricht ist zu lang. Bitte kürze sie etwas.");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("chatMessages", {
      threadId: args.threadId,
      familyId,
      senderId: userId,
      body,
      createdAt: now,
    });

    await ctx.db.patch(args.threadId, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: body.length > 80 ? `${body.slice(0, 77)}…` : body,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendChatMessagePush, {
      familyId,
      senderId: userId,
      threadId: args.threadId,
      messageId,
      participantIds: thread.participantIds,
      preview: body,
    });

    return await ctx.db.get(messageId);
  },
});
