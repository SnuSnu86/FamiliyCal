import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { type Auth } from "convex/server";
import { checkStorageQuota } from "./chats";

const MESSAGE_LIMIT = 100;
const SECURE_PREVIEW = "🔒 Verschlüsselte Nachricht";
const SECURE_PUSH_PREVIEW = "🔒 Neue sichere Nachricht";

function appError(code: string, message: string) {
  return new ConvexError({ code, message });
}

async function requireUser(ctx: { auth: Auth; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("AUTH_REQUIRED", "Bitte melde dich an, um sichere Chats zu nutzen.");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user?.familyId) throw appError("FAMILY_REQUIRED", "Du bist noch keiner Familie zugeordnet.");
  return { userId: identity.subject, user, familyId: user.familyId };
}

function createSecureDirectKey(userA: string, userB: string) {
  return `secure:${[userA, userB].sort((a, b) => a.localeCompare(b)).join(":")}`;
}

function assertSecureParticipant(thread: any, userId: string) {
  if (thread.type !== "secure_direct") {
    throw appError("THREAD_TYPE_INVALID", "Dieser Chat ist kein sicherer Direktchat.");
  }
  if (!thread.participantIds.includes(userId)) {
    throw appError("THREAD_ACCESS_DENIED", "Du bist kein Teilnehmer dieses sicheren Chats.");
  }
}

async function getSecureThreadForUser(ctx: { auth: Auth; db: any }, threadId: any) {
  const { userId, user, familyId } = await requireUser(ctx);
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.familyId !== familyId) {
    throw appError("THREAD_ACCESS_DENIED", "Dieser sichere Chat gehört nicht zu deiner Familie.");
  }
  assertSecureParticipant(thread, userId);
  return { thread, userId, user, familyId };
}

export const getOrCreateSecureDirectThread = mutation({
  args: { targetUserId: v.string() },
  handler: async (ctx, args) => {
    const { userId, familyId } = await requireUser(ctx);
    if (args.targetUserId === userId) {
      throw appError("SELF_CHAT_DENIED", "Für dich selbst kann kein sicherer Direktchat gestartet werden.");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.targetUserId))
      .unique();

    if (!targetUser || targetUser.familyId !== familyId) {
      throw appError("FAMILY_ACCESS_DENIED", "Dieses Familienmitglied ist nicht verfügbar.");
    }
    if (!targetUser.publicKey) {
      throw appError("E2EE_PUBLIC_KEY_MISSING", "Dieses Familienmitglied hat E2EE noch nicht eingerichtet.");
    }

    const directKey = createSecureDirectKey(userId, args.targetUserId);
    const existing = await ctx.db
      .query("chatThreads")
      .withIndex("by_familyId_directKey", (q) => q.eq("familyId", familyId).eq("directKey", directKey))
      .first();
    if (existing) return existing;

    const now = Date.now();
    const threadId = await ctx.db.insert("chatThreads", {
      familyId,
      type: "secure_direct",
      title: targetUser.name ?? targetUser.email ?? "Sicherer Chat",
      participantIds: [userId, args.targetUserId].sort((a, b) => a.localeCompare(b)),
      directKey,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: SECURE_PREVIEW,
    });

    return await ctx.db.get(threadId);
  },
});

export const sendSecureMessage = mutation({
  args: { threadId: v.id("chatThreads"), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args) => {
    const { thread, userId, user, familyId } = await getSecureThreadForUser(ctx, args.threadId);
    if (!args.ciphertext.trim() || !args.iv.trim()) {
      throw appError("EMPTY_SECURE_MESSAGE", "Die verschlüsselte Nachricht ist leer.");
    }

    await checkStorageQuota(ctx, user, familyId);

    const now = Date.now();
    const messageId = await ctx.db.insert("secureChats", {
      threadId: args.threadId,
      familyId,
      senderId: userId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      createdAt: now,
    });

    await ctx.db.patch(args.threadId, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: SECURE_PREVIEW,
    });

    await ctx.scheduler.runAfter(0, internal.push.sendChatMessagePush, {
      familyId,
      senderId: userId,
      threadId: args.threadId,
      messageId,
      participantIds: thread.participantIds,
      preview: SECURE_PUSH_PREVIEW,
    });

    return await ctx.db.get(messageId);
  },
});

export const listSecureMessages = query({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    await getSecureThreadForUser(ctx, args.threadId);
    const messages = await ctx.db
      .query("secureChats")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(MESSAGE_LIMIT);
    return messages.reverse();
  },
});
