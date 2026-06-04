import { computeKeyFingerprint, publicKeysMatch } from "@packages/shared";
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

    await ctx.scheduler.runAfter(0, internal.push.sendSecureChatMessagePush, {
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

export async function verifyParticipantKeyHandler(
  ctx: { auth: Auth; db: any },
  args: { verifiedUserId: string; publicKey: string; fingerprint: string },
) {
    const { userId, user, familyId } = await requireUser(ctx);
    if (args.verifiedUserId === userId) {
      throw appError("SELF_VERIFICATION_DENIED", "Du kannst deinen eigenen Schlüssel nicht als Gegenüber verifizieren.");
    }
    if (!args.publicKey.trim() || !args.fingerprint.trim()) {
      throw appError("KEY_VERIFICATION_INVALID", "Öffentlicher Schlüssel und Fingerprint sind erforderlich.");
    }

    const verifiedUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q: any) => q.eq("clerkId", args.verifiedUserId))
      .unique();
    if (!verifiedUser || verifiedUser.familyId !== familyId) {
      throw appError("FAMILY_ACCESS_DENIED", "Dieses Familienmitglied ist nicht verfügbar.");
    }

    // Defense-in-depth: trust the server's stored key as the anchor, not the
    // client-submitted value. Reject if the scanned key no longer matches the
    // current server key or if the fingerprint is inconsistent with it.
    if (!verifiedUser.publicKey || !publicKeysMatch(verifiedUser.publicKey, args.publicKey)) {
      throw appError("KEY_VERIFICATION_MISMATCH", "Der übermittelte Schlüssel stimmt nicht mit dem aktuellen Server-Schlüssel überein.");
    }
    const expectedFingerprint = await computeKeyFingerprint(args.publicKey);
    if (expectedFingerprint !== args.fingerprint) {
      throw appError("KEY_VERIFICATION_MISMATCH", "Der Fingerprint stimmt nicht mit dem öffentlichen Schlüssel überein.");
    }

    const existing = await ctx.db
      .query("keyVerifications")
      .withIndex("by_verifierId_verifiedUserId", (q: any) => q.eq("verifierId", userId).eq("verifiedUserId", args.verifiedUserId))
      .first();

    const now = Date.now();
    const record = {
      familyId,
      verifierId: userId,
      verifiedUserId: args.verifiedUserId,
      publicKey: args.publicKey,
      fingerprint: args.fingerprint,
      createdAt: now,
    };

    let verificationId;
    if (existing) {
      verificationId = existing._id;
      await ctx.db.patch(existing._id, record);
    } else {
      verificationId = await ctx.db.insert("keyVerifications", record);
    }

    await ctx.db.insert("activityFeedEntries", {
      familyId,
      actorId: userId,
      type: "key_verified",
      entityType: "user",
      entityId: args.verifiedUserId,
      summary: `${user.name ?? user.email ?? userId} hat den E2EE-Schlüssel von ${verifiedUser.name ?? verifiedUser.email ?? args.verifiedUserId} verifiziert.`,
      metadata: { verifiedUserId: args.verifiedUserId, fingerprint: args.fingerprint },
      createdAt: now,
    });

    return await ctx.db.get(verificationId);
}

export const verifyParticipantKey = mutation({
  args: { verifiedUserId: v.string(), publicKey: v.string(), fingerprint: v.string() },
  handler: (ctx, args) => verifyParticipantKeyHandler(ctx, args),
});

export async function getVerificationStatusHandler(
  ctx: { auth: Auth; db: any },
  args: { verifiedUserId: string },
) {
    const { userId, familyId } = await requireUser(ctx);
    const verification = await ctx.db
      .query("keyVerifications")
      .withIndex("by_verifierId_verifiedUserId", (q: any) => q.eq("verifierId", userId).eq("verifiedUserId", args.verifiedUserId))
      .first();
    if (!verification || verification.familyId !== familyId) return null;

    // TOFU: a stored verification only counts while the verified key still
    // matches the current server key. After a key rotation the badge must
    // downgrade to "not verified" instead of vouching for the new key. We also
    // re-check current shared-family membership: a verification must not keep
    // vouching for someone who has since left (or moved to another) family, even
    // if they kept the same key. Comparison is canonical, not raw-string.
    const verifiedUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q: any) => q.eq("clerkId", args.verifiedUserId))
      .unique();
    if (!verifiedUser || verifiedUser.familyId !== familyId) return null;
    if (!publicKeysMatch(verifiedUser.publicKey, verification.publicKey)) return null;

    return verification;
}

export const getVerificationStatus = query({
  args: { verifiedUserId: v.string() },
  handler: (ctx, args) => getVerificationStatusHandler(ctx, args),
});

// Pull side of the bidirectional sync for key_verifications (6-4 AC4). Returns
// the caller's currently-VALID verifications only — TOFU-filtered the same way
// getVerificationStatus is: a record is excluded once the verified user leaves
// the family or rotates their key. The client reconcile mirrors exactly this
// set, so locally cached rows for rotated/expired keys are pruned automatically.
export async function listMyVerificationsHandler(ctx: { auth: Auth; db: any }) {
    const { userId, familyId } = await requireUser(ctx);
    const records = await ctx.db
      .query("keyVerifications")
      .withIndex("by_verifierId_verifiedUserId", (q: any) => q.eq("verifierId", userId))
      .take(500);

    const valid: typeof records = [];
    for (const record of records) {
      if (record.familyId !== familyId) continue;
      const verifiedUser = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q: any) => q.eq("clerkId", record.verifiedUserId))
        .unique();
      if (!verifiedUser || verifiedUser.familyId !== familyId) continue;
      if (!publicKeysMatch(verifiedUser.publicKey, record.publicKey)) continue;
      valid.push(record);
    }
    return valid;
}

export const listMyVerifications = query({
  args: {},
  handler: (ctx) => listMyVerificationsHandler(ctx),
});
