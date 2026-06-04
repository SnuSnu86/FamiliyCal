import { findResourceConflict, mergeCalendarEventFields, type ResourceConflictEvent } from "@packages/shared";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
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
const REVIEWER_ROLES = new Set(["ROLE-001", "ROLE-002"]);
const PARENT_OR_OWNER_ROLES = new Set(["ROLE-001", "ROLE-002"]);
const CHILD_ROLE = "ROLE-004";

function assertCanReviewDraft(user: { role?: string | null }) {
  if (!REVIEWER_ROLES.has(user.role ?? "")) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Nur Eltern oder Familieninhaber dürfen Terminvorschläge prüfen." });
  }
}

export function validateDraftConfirmationReview(user: { role?: string | null }, previousStatus?: string, nextStatus?: string) {
  const confirmsDraft = previousStatus === "draft" && nextStatus === "confirmed";
  if (confirmsDraft) assertCanReviewDraft(user);
  return confirmsDraft;
}

export function sanitizeCaregiverEvent(event: Record<string, any>) {
  if (!event.isPrivate && !event.private && !event.floatingTime) return event;

  return {
    ...event,
    title: "Privater Termin",
    description: undefined,
    rrule: undefined,
    vetoReason: undefined,
  };
}

export function sanitizeSchedulingEvent(event: Record<string, any>) {
  const base = {
    ...event,
    comments: undefined,
    notes: undefined,
  };

  if (!event.isPrivate && !event.private) return base;

  return {
    ...base,
    title: "Privater Termin",
    description: undefined,
    rrule: undefined,
  };
}

export async function listEventsForSchedulingHandler(ctx: { db: { query: (table: string) => any } }, args: { familyId: any; startDate: string; endDate: string; resourceId?: any }) {
  assertValidDateRange(args.startDate, args.endDate);
  const events = await ctx.db
    .query("calendarEvents")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId))
    .collect();

  return events
    .filter((event: any) => event.startDate < args.endDate && event.endDate > args.startDate)
    .filter((event: any) => !args.resourceId || event.resourceId === args.resourceId || !event.resourceId)
    .map(sanitizeSchedulingEvent);
}

export async function createDraftSuggestionsHandler(
  ctx: { db: { insert: (table: string, value: Record<string, unknown>) => Promise<any>; get: (id: any) => Promise<any> } },
  args: { familyId: any; requestedTitle: string; slots: Array<{ startDate: string; endDate: string }>; resourceId?: any; schedulingBatchId?: string },
) {
  if (args.slots.length !== 3) {
    throw new ConvexError({ code: "INVALID_SCHEDULING_SLOTS", message: "Es müssen genau 3 Terminvorschläge erzeugt werden." });
  }

  const now = Date.now();
  const batchId = args.schedulingBatchId ?? generateCaregiverClientId().replace("caregiver-", "scheduling-");
  const created = [];
  for (const [index, slot] of args.slots.entries()) {
    assertValidDateRange(slot.startDate, slot.endDate);
    const eventId = await ctx.db.insert("calendarEvents", {
      familyId: args.familyId,
      creatorId: "scheduling-agent",
      clientId: `${batchId}-${index + 1}`,
      title: `[Vorschlag] ${args.requestedTitle}`,
      description: "Automatisch generierter Terminvorschlag",
      startDate: slot.startDate,
      endDate: slot.endDate,
      allDay: false,
      floatingTime: false,
      status: "draft",
      resourceId: args.resourceId,
      updatedAt: now,
      createdAt: now,
    });
    created.push({ serverId: eventId, serverRecord: await ctx.db.get(eventId) });
  }
  return { schedulingBatchId: batchId, suggestions: created };
}

function assertValidDateRange(startDate: string, endDate: string) {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new ConvexError(INVALID_DATE_ERROR);
  }
}

function generateCaregiverClientId() {
  const maybeCrypto = globalThis.crypto as Crypto | undefined;
  if (maybeCrypto?.randomUUID) return `caregiver-${maybeCrypto.randomUUID()}`;
  return `caregiver-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function detectResourceConflict(
  ctx: { db: any },
  candidate: ResourceConflictEvent & { familyId: unknown; resourceId?: string },
  selfId: unknown,
) {
  if (!candidate.resourceId) return null;

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

  return result.conflict ?? null;
}

export function assertRoleCanBypassResourceConflict(user: { role?: string | null }, conflict: unknown) {
  if (!conflict) return false;
  if (PARENT_OR_OWNER_ROLES.has(user.role ?? "")) return true;
  throw new ConvexError({
    code: "RESOURCE_CONFLICT",
    message: "Diese Ressource ist in diesem Zeitraum bereits gebucht.",
    conflictingEventId: (conflict as any).event.id,
  });
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
      const previousStatus = existing.status;
      const { record, mergedFields } = mergeCalendarEventFields(
        localRecord,
        existing,
        args.locallyChangedFields ?? [],
      );
      const nextStatus = record.status as string | undefined;
      const confirmsDraft = validateDraftConfirmationReview(user, previousStatus, nextStatus);
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
      const resourceConflict = await detectResourceConflict(ctx, { ...patch, id: String(existing._id), clientId: patch.clientId }, existing._id);
      const canBypassResourceConflict = assertRoleCanBypassResourceConflict(user, resourceConflict);
      await ctx.db.patch(existing._id, patch);
      if (confirmsDraft && existing.creatorId === "scheduling-agent" && typeof existing.clientId === "string") {
        const batchId = existing.clientId.replace(/-\d+$/, "");
        const siblingDrafts = await ctx.db
          .query("calendarEvents")
          .withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId))
          .collect();
        await Promise.all(
          siblingDrafts
            .filter((event: any) => event._id !== existing._id && event.creatorId === "scheduling-agent" && event.status === "draft" && typeof event.clientId === "string" && event.clientId.startsWith(`${batchId}-`))
            .map((event: any) => ctx.db.delete(event._id)),
        );
        patch.title = patch.title.replace(/^\[Vorschlag\]\s*/, "");
        await ctx.db.patch(existing._id, { title: patch.title });
      }
      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "calendar_event",
        entityType: "calendarEvent",
        entityId: String(existing._id),
        summary: confirmsDraft ? "Terminvorschlag bestätigt" : "Kalendertermin aktualisiert",
        createdAt: now,
      });
      if (canBypassResourceConflict && resourceConflict) {
        await ctx.scheduler.runAfter(0, (internal as any).agents.triggerConflictAgent, {
          familyId: args.familyId,
          createdBy: userId,
          eventAId: existing._id,
          eventBId: resourceConflict.event.id as any,
        });
      }
      await ctx.scheduler.runAfter(0, (internal as any).agents.archiveResolvedConflictThreads, { familyId: args.familyId });
      const serverRecord = await ctx.db.get(existing._id);
      return { serverId: existing._id, serverRecord, mergedFields };
    }

    const resourceConflict = await detectResourceConflict(ctx, { ...localRecord, id: args.clientId }, undefined);
    const canBypassResourceConflict = assertRoleCanBypassResourceConflict(user, resourceConflict);

    const eventId = await ctx.db.insert("calendarEvents", {
      ...localRecord,
      createdAt: now,
    });
    await recordActivity(ctx, {
      familyId: args.familyId,
      actorId: userId,
      type: "calendar_event",
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

    if (canBypassResourceConflict && resourceConflict) {
      await ctx.scheduler.runAfter(0, (internal as any).agents.triggerConflictAgent, {
        familyId: args.familyId,
        createdBy: userId,
        eventAId: eventId,
        eventBId: resourceConflict.event.id as any,
      });
    }
    await ctx.scheduler.runAfter(0, (internal as any).agents.archiveResolvedConflictThreads, { familyId: args.familyId });

    return {
      serverId: eventId,
      serverRecord,
      mergedFields: Object.fromEntries(Object.keys(localRecord).map((field) => [field, "local"])),
    };
  },
});

type DeleteEventArgs = { eventId: any; familyId: any };

type DeleteEventCtx = {
  auth: Auth;
  db: {
    get: (id: any) => Promise<any>;
    delete: (id: any) => Promise<void>;
    query: (table: string) => any;
  };
  scheduler?: { runAfter: (delay: number, fn: any, args: any) => Promise<unknown> };
};

export async function deleteEventHandler(ctx: DeleteEventCtx, args: DeleteEventArgs) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", userId))
    .first();

  const event = await ctx.db.get(args.eventId);
  if (!event || event.familyId !== args.familyId) {
    throw new ConvexError({ code: "EVENT_ACCESS_DENIED", message: "Dieser Termin gehört nicht zu deiner Familie." });
  }
  if (!user || user.familyId !== args.familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }
  assertCanReviewDraft(user);

  const now = Date.now();
  await ctx.db.delete(args.eventId);
  await recordActivity(ctx as any, {
    familyId: args.familyId,
    actorId: userId,
    type: "calendar_event",
    entityType: "calendarEvent",
    entityId: String(args.eventId),
    summary: "Terminvorschlag abgelehnt",
    createdAt: now,
  });
  await ctx.scheduler?.runAfter(0, (internal as any).agents.archiveResolvedConflictThreads, { familyId: args.familyId });

  return { deleted: true, eventId: args.eventId };
}

export const deleteEvent = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => deleteEventHandler(ctx as any, args),
});

type VetoCtx = {
  auth: Auth;
  db: {
    get: (id: any) => Promise<any>;
    patch: (id: any, value: Record<string, unknown>) => Promise<void>;
    insert?: (table: string, value: Record<string, unknown>) => Promise<any>;
    query: (table: string) => any;
  };
};

async function requireEventAndUserForVeto(ctx: VetoCtx, eventId: any) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", userId))
    .first();
  const event = await ctx.db.get(eventId);

  if (!event) {
    throw new ConvexError({ code: "EVENT_NOT_FOUND", message: "Dieser Termin wurde nicht gefunden." });
  }
  if (!user || user.familyId !== event.familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }

  return { userId, user, event };
}

export async function raiseVetoHandler(ctx: VetoCtx, args: { eventId: any; reason: string }) {
  const { userId, user, event } = await requireEventAndUserForVeto(ctx, args.eventId);
  if (user.role !== CHILD_ROLE) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Nur Kinder dürfen Einspruch gegen Termine erheben." });
  }

  const reason = args.reason.trim();
  if (!reason) {
    throw new ConvexError({ code: "INVALID_VETO_REASON", message: "Bitte gib einen kurzen Grund für den Einspruch an." });
  }

  const now = Date.now();
  await ctx.db.patch(args.eventId, {
    vetoStatus: "vetoed",
    vetoReason: reason,
    vetoChildId: userId,
    updatedAt: now,
  });
  await recordActivity(ctx as any, {
    familyId: event.familyId,
    actorId: userId,
    type: "event_comment",
    entityType: "calendarEvent",
    entityId: String(args.eventId),
    summary: `Einspruch von ${user.name ?? "Kind"} erhoben`,
    createdAt: now,
  });

  return { vetoStatus: "vetoed", eventId: args.eventId };
}

export const raiseVeto = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    reason: v.string(),
  },
  handler: async (ctx, args) => raiseVetoHandler(ctx as any, args),
});

export async function clearVetoHandler(ctx: VetoCtx, args: { eventId: any }) {
  const { userId, user, event } = await requireEventAndUserForVeto(ctx, args.eventId);
  if (!PARENT_OR_OWNER_ROLES.has(user.role ?? "")) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Nur Eltern oder Familieninhaber dürfen Einsprüche klären." });
  }

  const now = Date.now();
  await ctx.db.patch(args.eventId, {
    vetoStatus: undefined,
    vetoReason: undefined,
    vetoChildId: undefined,
    updatedAt: now,
  });
  await recordActivity(ctx as any, {
    familyId: event.familyId,
    actorId: userId,
    type: "event_comment",
    entityType: "calendarEvent",
    entityId: String(args.eventId),
    summary: "Einspruch für Termin zurückgesetzt",
    createdAt: now,
  });

  return { cleared: true, eventId: args.eventId };
}

export const clearVeto = mutation({
  args: {
    eventId: v.id("calendarEvents"),
  },
  handler: async (ctx, args) => clearVetoHandler(ctx as any, args),
});

export const listEventsForScheduling = query({
  args: {
    familyId: v.id("families"),
    startDate: v.string(),
    endDate: v.string(),
    resourceId: v.optional(v.id("virtualMembers")),
  },
  handler: async (ctx, args) => listEventsForSchedulingHandler(ctx as any, args),
});

export const createDraftSuggestions = mutation({
  args: {
    familyId: v.id("families"),
    requestedTitle: v.string(),
    slots: v.array(v.object({ startDate: v.string(), endDate: v.string() })),
    resourceId: v.optional(v.id("virtualMembers")),
    schedulingBatchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => createDraftSuggestionsHandler(ctx as any, args),
});

export const listEventsForCaregiver = query({
  args: {
    familyId: v.id("families"),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.secret !== process.env.CAREGIVER_API_SECRET) {
      throw new ConvexError({ code: "CAREGIVER_API_UNAUTHORIZED", message: "Caregiver API ist nicht autorisiert." });
    }

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .collect();

    return events.map(sanitizeCaregiverEvent);
  },
});

type ProposeEventForCaregiverArgs = {
  familyId: any;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  secret: string;
};

export async function proposeEventForCaregiverHandler(
  ctx: { db: { insert: (table: string, value: Record<string, unknown>) => Promise<any>; get: (id: any) => Promise<any> } },
  args: ProposeEventForCaregiverArgs,
) {
  if (args.secret !== process.env.CAREGIVER_API_SECRET) {
    throw new ConvexError({ code: "CAREGIVER_API_UNAUTHORIZED", message: "Caregiver API ist nicht autorisiert." });
  }

  assertValidDateRange(args.startDate, args.endDate);
  const now = Date.now();
  const eventId = await ctx.db.insert("calendarEvents", {
    familyId: args.familyId,
    creatorId: "caregiver",
    clientId: generateCaregiverClientId(),
    title: args.title,
    description: args.description,
    startDate: args.startDate,
    endDate: args.endDate,
    allDay: args.allDay,
    floatingTime: false,
    status: "draft",
    updatedAt: now,
    createdAt: now,
  });
  const serverRecord = await ctx.db.get(eventId);

  return { serverId: eventId, serverRecord };
}

export const proposeEventForCaregiver = mutation({
  args: {
    familyId: v.id("families"),
    title: v.string(),
    description: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    allDay: v.boolean(),
    secret: v.string(),
  },
  handler: async (ctx, args) => proposeEventForCaregiverHandler(ctx as any, args),
});
