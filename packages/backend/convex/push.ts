import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export const listOtherFamilyTokens = internalQuery({
  args: {
    familyId: v.id("families"),
    creatorId: v.string(),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .collect();

    return tokens.filter((token) => token.userId !== args.creatorId);
  },
});

export const listThreadRecipientTokens = internalQuery({
  args: {
    familyId: v.id("families"),
    senderId: v.string(),
    participantIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .collect();

    const recipients = new Set(args.participantIds.filter((userId) => userId !== args.senderId));
    return tokens.filter((token) => recipients.has(token.userId));
  },
});

export const sendCalendarEventCreatedPush = internalAction({
  args: {
    familyId: v.id("families"),
    creatorId: v.string(),
    calendarEventId: v.id("calendarEvents"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.runQuery(internal.push.listOtherFamilyTokens, {
      familyId: args.familyId,
      creatorId: args.creatorId,
    });

    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map(({ expoPushToken }: { expoPushToken: string }) => ({
      to: expoPushToken,
      title: "Neuer Familientermin",
      body: args.title,
      data: { calendarEventId: args.calendarEventId },
    }));

    let sent = 0;
    for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const accessToken = process.env.EXPO_ACCESS_TOKEN;
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          console.warn("Expo push HTTP error", { status: response.status, body: errorBody });
          continue;
        }

        // Expo returns a per-message ticket array; an HTTP 200 can still contain
        // per-recipient errors (e.g. DeviceNotRegistered). Count only successes.
        const result = (await response.json().catch(() => null)) as
          | { data?: Array<{ status?: string; message?: string; details?: unknown }> }
          | null;
        const tickets = result?.data ?? [];
        const failedTickets = tickets.filter((ticket) => ticket?.status === "error");
        if (failedTickets.length > 0) {
          console.warn("Expo push ticket errors", failedTickets);
        }
        sent += batch.length - failedTickets.length;
      } catch (error) {
        console.warn("Expo push dispatch failed", error);
      }
    }

    return { sent };
  },
});

export const listSelectedFamilyTokens = internalQuery({
  args: {
    familyId: v.id("families"),
    userIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .collect();

    const recipients = new Set(args.userIds);
    return tokens.filter((token) => recipients.has(token.userId));
  },
});

export const sendChatMessagePush = internalAction({
  args: {
    familyId: v.id("families"),
    senderId: v.string(),
    threadId: v.id("chatThreads"),
    messageId: v.id("chatMessages"),
    participantIds: v.array(v.string()),
    preview: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens: Array<{ expoPushToken: string }> = await ctx.runQuery(internal.push.listThreadRecipientTokens, {
      familyId: args.familyId,
      senderId: args.senderId,
      participantIds: args.participantIds,
    });

    return dispatchPushNotifications(tokens, "Neue Chat-Nachricht", args.preview.trim(), {
      chatThreadId: args.threadId,
      chatMessageId: args.messageId,
    });
  },
});

export const sendSecureChatMessagePush = internalAction({
  args: {
    familyId: v.id("families"),
    senderId: v.string(),
    threadId: v.id("chatThreads"),
    messageId: v.id("secureChats"),
    participantIds: v.array(v.string()),
    preview: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens: Array<{ expoPushToken: string }> = await ctx.runQuery(internal.push.listThreadRecipientTokens, {
      familyId: args.familyId,
      senderId: args.senderId,
      participantIds: args.participantIds,
    });

    return dispatchPushNotifications(tokens, "Neue sichere Nachricht", args.preview.trim(), {
      chatThreadId: args.threadId,
      secureChatMessageId: args.messageId,
    });
  },
});

async function dispatchPushNotifications(
  tokens: Array<{ expoPushToken: string }>,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<{ sent: number }> {
  if (tokens.length === 0) return { sent: 0 };

  const messages = tokens.map(({ expoPushToken }: { expoPushToken: string }) => ({
    to: expoPushToken,
    title,
    body: body.length > 80 ? `${body.slice(0, 77)}…` : body,
    data,
  }));

  let sent = 0;
  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        console.warn("Expo push HTTP error", { status: response.status, body: errorBody });
        continue;
      }

      const result = (await response.json().catch(() => null)) as
        | { data?: Array<{ status?: string; message?: string; details?: unknown }> }
        | null;
      const tickets = result?.data ?? [];
      const failedTickets = tickets.filter((ticket) => ticket?.status === "error");
      if (failedTickets.length > 0) {
        console.warn("Expo push ticket errors", failedTickets);
      }
      sent += batch.length - failedTickets.length;
    } catch (error) {
      console.warn("Expo push dispatch failed", error);
    }
  }

  return { sent };
}

export const sendConflictPush = internalAction({
  args: {
    familyId: v.id("families"),
    parentIds: v.array(v.string()),
    threadId: v.id("chatThreads"),
    eventAId: v.id("calendarEvents"),
    eventBId: v.id("calendarEvents"),
    title: v.string(),
    conflictingTitle: v.string(),
    resourceName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens = await ctx.runQuery(internal.push.listSelectedFamilyTokens, {
      familyId: args.familyId,
      userIds: args.parentIds,
    });
    const resource = args.resourceName ? ` Ressource: ${args.resourceName}.` : "";
    return await dispatchPushNotifications(
      tokens,
      "Kalenderkonflikt erkannt",
      `${args.title} überschneidet sich mit ${args.conflictingTitle}.${resource}`,
      { chatThreadId: args.threadId, eventAId: args.eventAId, eventBId: args.eventBId }
    );
  },
});

export const sendMemoUpdatedPush = internalAction({
  args: {
    familyId: v.id("families"),
    creatorId: v.string(),
    memoId: v.id("memos"),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens = await ctx.runQuery(internal.push.listOtherFamilyTokens, {
      familyId: args.familyId,
      creatorId: args.creatorId,
    });
    return await dispatchPushNotifications(tokens, "Memo aktualisiert", args.title.trim(), { memoId: args.memoId });
  },
});

export const sendListUpdatedPush = internalAction({
  args: {
    familyId: v.id("families"),
    creatorId: v.string(),
    listId: v.id("lists"),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens = await ctx.runQuery(internal.push.listOtherFamilyTokens, {
      familyId: args.familyId,
      creatorId: args.creatorId,
    });
    return await dispatchPushNotifications(tokens, "Liste aktualisiert", args.title.trim(), { listId: args.listId });
  },
});

export const sendAlbumUpdatedPush = internalAction({
  args: {
    familyId: v.id("families"),
    creatorId: v.string(),
    albumId: v.id("albums"),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens = await ctx.runQuery(internal.push.listOtherFamilyTokens, {
      familyId: args.familyId,
      creatorId: args.creatorId,
    });
    return await dispatchPushNotifications(tokens, "Album aktualisiert", args.name.trim(), { albumId: args.albumId });
  },
});

