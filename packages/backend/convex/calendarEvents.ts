import { findResourceConflict, mergeCalendarEventFields, type ResourceConflictEvent } from "@packages/shared";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { type Auth } from "convex/server";
import { recordActivity } from "./activityFeed";

async function requireUserId({ auth }: { auth: Auth }) {
  const userId = (await auth.getUserIdentity())?.subject ?? null;
  if (userId) return userId;
  throw new ConvexError({ code: "AUTH_REQUIRED", message: "Bitte melde dich an, um Kalendertermine zu synchronisieren." });
}

const optionalString = v.optional(v.string());
const INVALID_DATE_ERROR = { code: "INVALID_DATE", message: "Das Datum ist ungültig. Bitte prüfe Start und Ende." };

function assertValidDateRange(startDate: string, endDate: string) {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new ConvexError(INVALID_DATE_ERROR);
  }
}

async function assertNoResourceConflict(
  ctx: { db: any },
  candidate: ResourceConflictEvent & { familyId: unknown; resourceId?: string },
  selfId: unknown,
) {
  if (!candidate.resourceId) return;

  const existingEvents = await ctx.db
    .query("calendarEvents")
    .withIndex("by_resourceId", (q: any) => q.eq("resourceId", candidate.resourceId))
    .filter((q: any) => q.eq(q.field("familyId"), candidate.familyId))
    .collect();

  const result = findResourceConflict({
    candidate: {
      ...candidate,
      id: String(selfId ?? candidate.id),
      resourceId: candidate.resourceId,
    },
    existingEvents: existingEvents.map((event: any) => ({
      ...event,
      id: String(event._id),
      clientId: event.clientId,
      resourceId: event.resourceId,
    })),
  });

  if (result.error) {
    throw new ConvexError({ code: result.error.code, message: result.error.message });
  }

  if (result.conflict) {
    throw new ConvexError({
      code: "RESOURCE_CONFLICT",
      message: "Diese Ressource ist in diesem Zeitraum bereits gebucht.",
      conflictingEventId: result.conflict.event.id,
    });
  }
}

export const syncCalendarEvent = mutation({
  args: {
    serverId: v.optional(v.id("calendarEvents")),
    familyId: v.id("families"),
    clientId: v.string(),
    title: v.string(),
    description: optionalString,
    startDate: v.string(),
    endDate: v.string(),
    allDay: v.boolean(),
    rrule: optionalString,
    timezoneId: optionalString,
    floatingTime: v.boolean(),
    vetoStatus: optionalString,
    vetoReason: optionalString,
    vetoChildId: optionalString,
    status: optionalString,
    resourceId: v.optional(v.id("virtualMembers")),
    locallyChangedFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
      .first();

    if (!user || user.familyId !== args.familyId) {
      throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
    }

    const now = Date.now();
    assertValidDateRange(args.startDate, args.endDate);
    const localRecord = {
      familyId: args.familyId,
      creatorId: userId,
      clientId: args.clientId,
      title: args.title,
      description: args.description,
      startDate: args.startDate,
      endDate: args.endDate,
      allDay: args.allDay,
      rrule: args.rrule,
      timezoneId: args.timezoneId,
      floatingTime: args.floatingTime,
      vetoStatus: args.vetoStatus,
      vetoReason: args.vetoReason,
      vetoChildId: args.vetoChildId,
      status: args.status,
      resourceId: args.resourceId,
      updatedAt: now,
    };

    const existingByServerId = args.serverId ? await ctx.db.get(args.serverId) : null;
    // Scope the idempotency lookup to the caller's family so a clientId collision
    // across families resolves to an insert instead of throwing on a foreign event.
    const existingByClientId = await ctx.db
      .query("calendarEvents")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .filter((q) => q.eq(q.field("familyId"), args.familyId))
      .first();
    const existing = existingByServerId ?? existingByClientId;

    if (existing && existing.familyId !== args.familyId) {
      throw new ConvexError({ code: "EVENT_ACCESS_DENIED", message: "Dieser Termin gehört nicht zu deiner Familie." });
    }

    if (args.resourceId) {
      const resource = await ctx.db.get(args.resourceId);
      if (!resource || resource.familyId !== args.familyId) {
        throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED", message: "Die Ressource gehört nicht zu deiner Familie." });
      }
      if (resource.type !== "resource") {
        throw new ConvexError({ code: "INVALID_RESOURCE", message: "Diese Auswahl ist keine buchbare Ressource." });
      }
    }

    if (existing) {
      const { record, mergedFields } = mergeCalendarEventFields(
        localRecord,
        existing,
        args.locallyChangedFields ?? [],
      );
      const patch = {
        familyId: args.familyId,
        // creatorId/createdAt are immutable ownership metadata: never accept a
        // client-supplied or merged value on update, always keep the original.
        creatorId: existing.creatorId,
        clientId: String(record.clientId),
        title: String(record.title),
        description: record.description as string | undefined,
        startDate: String(record.startDate),
        endDate: String(record.endDate),
        allDay: Boolean(record.allDay),
        rrule: record.rrule as string | undefined,
        timezoneId: record.timezoneId as string | undefined,
        floatingTime: Boolean(record.floatingTime),
        vetoStatus: record.vetoStatus as string | undefined,
        vetoReason: record.vetoReason as string | undefined,
        vetoChildId: record.vetoChildId as string | undefined,
        status: record.status as string | undefined,
        resourceId: record.resourceId as typeof args.resourceId,
        updatedAt: now,
      };
      assertValidDateRange(patch.startDate, patch.endDate);
      await assertNoResourceConflict(ctx, { ...patch, id: String(existing._id), clientId: patch.clientId }, existing._id);
      await ctx.db.patch(existing._id, patch);
      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "event_comment",
        entityType: "calendarEvent",
        entityId: String(existing._id),
        summary: "Kalendertermin aktualisiert",
        createdAt: now,
      });
      const serverRecord = await ctx.db.get(existing._id);
      return { serverId: existing._id, serverRecord, mergedFields };
    }

    await assertNoResourceConflict(ctx, { ...localRecord, id: args.clientId }, undefined);

    const eventId = await ctx.db.insert("calendarEvents", {
      ...localRecord,
      createdAt: now,
    });
    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "event_comment",
      entityType: "calendarEvent",
      entityId: String(eventId),
      summary: "Kalendertermin erstellt",
      createdAt: now,
    });
    const serverRecord = await ctx.db.get(eventId);

    await ctx.scheduler.runAfter(0, internal.push.sendCalendarEventCreatedPush, {
      familyId: args.familyId,
      creatorId: userId,
      calendarEventId: eventId,
      title: args.title,
    });

    return {
      serverId: eventId,
      serverRecord,
      mergedFields: Object.fromEntries(Object.keys(localRecord).map((field) => [field, "local"])),
    };
  },
});
