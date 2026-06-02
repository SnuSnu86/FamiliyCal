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

export const sendChatMessagePush = internalAction({
  args: {
    familyId: v.id("families"),
    senderId: v.string(),
    threadId: v.id("chatThreads"),
    messageId: v.id("chatMessages"),
    participantIds: v.array(v.string()),
    preview: v.string(),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.runQuery(internal.push.listThreadRecipientTokens, {
      familyId: args.familyId,
      senderId: args.senderId,
      participantIds: args.participantIds,
    });

    if (tokens.length === 0) return { sent: 0 };

    const cleanPreview = args.preview.trim();
    const messages = tokens.map(({ expoPushToken }: { expoPushToken: string }) => ({
      to: expoPushToken,
      title: "Neue Chat-Nachricht",
      body: cleanPreview.length > 80 ? `${cleanPreview.slice(0, 77)}…` : cleanPreview,
      data: { chatThreadId: args.threadId, chatMessageId: args.messageId },
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
          console.warn("Expo chat push HTTP error", { status: response.status, body: errorBody });
          continue;
        }

        const result = (await response.json().catch(() => null)) as
          | { data?: Array<{ status?: string; message?: string; details?: unknown }> }
          | null;
        const tickets = result?.data ?? [];
        const failedTickets = tickets.filter((ticket) => ticket?.status === "error");
        if (failedTickets.length > 0) {
          console.warn("Expo chat push ticket errors", failedTickets);
        }
        sent += batch.length - failedTickets.length;
      } catch (error) {
        console.warn("Expo chat push dispatch failed", error);
      }
    }

    return { sent };
  },
});
