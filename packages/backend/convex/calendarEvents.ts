import { findResourceConflict, mergeCalendarEventFields, type ResourceConflictEvent } from "@packages/shared";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { type Auth } from "convex/server";
import { recordActivity } from "./activityFeed";

async function requireUserId({ auth }: { auth: Auth }) {
  const userId = (await auth.getUserIdentity())?.subject ?? null;
  if (userId) return userId;
  throw new ConvexError({ code: "AUTH_REQUIRED", message: "Bitte melde dich an, um Kalendertermine zu synchronisieren." });
}

async function requireFamilyAccess(ctx: any, familyId: any) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", userId))
    .first();
  if (!user) {
    throw new ConvexError({ code: "USER_NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
  if (user.familyId !== familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }
  return { userId, user };
}

async function requireParentFamilyAccess(ctx: any, familyId: any, clerkId?: string) {
  if (clerkId) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q: any) => q.eq("clerkId", clerkId))
      .first();
    if (!user || user.familyId !== familyId) {
      throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
    }
    assertCanReviewDraft(user);
    return { userId: clerkId, user };
  }

  const access = await requireFamilyAccess(ctx, familyId);
  assertCanReviewDraft(access.user);
  return access;
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

export function validateVetoFieldChange(
  user: { role?: string | null; clerkId: string },
  existing: { vetoStatus?: string; vetoReason?: string; vetoChildId?: string },
  patch: { vetoStatus?: string; vetoReason?: string; vetoChildId?: string },
): boolean {
  const isParent = PARENT_OR_OWNER_ROLES.has(user.role ?? "");
  const isChild = user.role === CHILD_ROLE;

  const vetoStatusChanged = existing.vetoStatus !== patch.vetoStatus;
  const vetoReasonChanged = existing.vetoReason !== patch.vetoReason;
  const vetoChildIdChanged = existing.vetoChildId !== patch.vetoChildId;
  const vetoChanged = vetoStatusChanged || vetoReasonChanged || vetoChildIdChanged;

  if (!vetoChanged) {
    return true;
  }

  if (isChild) {
    if (existing.vetoStatus === "vetoed" && patch.vetoStatus !== "vetoed") {
      throw new ConvexError({
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Kinder dürfen Einsprüche nicht zurücksetzen.",
      });
    }

    if (existing.vetoChildId && existing.vetoChildId !== user.clerkId) {
      throw new ConvexError({
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Du kannst den Einspruch eines anderen Kindes nicht bearbeiten.",
      });
    }

    if (patch.vetoChildId && patch.vetoChildId !== user.clerkId) {
      throw new ConvexError({
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Du darfst einen Einspruch nur unter deiner eigenen ID erheben.",
      });
    }
  } else if (!isParent) {
    throw new ConvexError({
      code: "INSUFFICIENT_PERMISSIONS",
      message: "Keine Berechtigung, Einsprüche zu bearbeiten.",
    });
  }

  return true;
}

export function assertEventBelongsToFamily(event: { familyId?: unknown } | null, familyId: unknown) {
  if (event && event.familyId !== familyId) {
    throw new ConvexError({ code: "EVENT_ACCESS_DENIED", message: "Dieser Termin gehört nicht zu deiner Familie." });
  }
  return true;
}

export function eventOverlapsCaregiverRange(
  event: { startDate: string; endDate: string; rrule?: string },
  range: { startDate: string; endDate: string },
): boolean {
  const eventStart = Date.parse(event.startDate);
  const eventEnd = Date.parse(event.endDate);
  const rangeStart = Date.parse(range.startDate);
  const rangeEnd = Date.parse(range.endDate);

  if (Number.isNaN(eventStart) || Number.isNaN(eventEnd) || Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) {
    return false;
  }

  if (eventStart < rangeEnd && eventEnd > rangeStart) {
    return true;
  }

  if (event.rrule && event.rrule.includes("FREQ=WEEKLY")) {
    if (eventStart >= rangeEnd) {
      return false;
    }
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const k = Math.floor((rangeStart - eventEnd) / WEEK) + 1;
    const occurrenceStart = eventStart + k * WEEK;
    return occurrenceStart < rangeEnd;
  }

  return false;
}

export function sanitizeCaregiverEvent(event: Record<string, any>) {
  const isPrivate = Boolean(event.isPrivate || event.private || event.floatingTime);
  return {
    _id: event._id,
    clientId: event.clientId,
    title: isPrivate ? "Privater Termin" : event.title,
    description: isPrivate ? undefined : event.description,
    startDate: event.startDate,
    endDate: event.endDate,
    allDay: event.allDay,
    status: event.status,
  };
}

export function sanitizeSchedulingEvent(event: Record<string, any>) {
  const isPrivate = Boolean(event.isPrivate || event.private);
  if (!isPrivate) {
    return {
      ...event,
      comments: undefined,
      notes: undefined,
    };
  }

  return {
    title: "Privater Termin",
    startDate: event.startDate,
    endDate: event.endDate,
    allDay: event.allDay,
  };
}

export async function listEventsForSchedulingHandler(
  ctx: { db: { query: (table: string) => any }; auth: Auth },
  args: { familyId: any; startDate: string; endDate: string; resourceId?: any }
) {
  await requireFamilyAccess(ctx as any, args.familyId);
  assertValidDateRange(args.startDate, args.endDate);
  const events = await ctx.db
    .query("calendarEvents")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId))
    .collect();

  return events
    .filter((event: any) => eventOverlapsCaregiverRange(event, { startDate: args.startDate, endDate: args.endDate }))
    .map(sanitizeSchedulingEvent);
}

export async function createDraftSuggestionsHandler(
  ctx: any,
  args: { familyId: any; requestedTitle: string; slots: Array<{ startDate: string; endDate: string }>; resourceId?: any; schedulingBatchId?: string; requestedByUserId?: string },
) {
  await requireParentFamilyAccess(ctx, args.familyId, args.requestedByUserId);
  if (args.slots.length !== 3) {
    throw new ConvexError({ code: "INVALID_SCHEDULING_SLOTS", message: "Es müssen genau 3 Terminvorschläge erzeugt werden." });
  }
  await validateDraftSuggestionSlots(ctx, args);

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

async function validateDraftSuggestionSlots(
  ctx: any,
  args: { familyId: any; slots: Array<{ startDate: string; endDate: string }>; resourceId?: any },
) {
  for (const slot of args.slots) {
    assertValidDateRange(slot.startDate, slot.endDate);
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

  const events = await ctx.db
    .query("calendarEvents")
    .withIndex("by_familyId", (q: any) => q.eq("familyId", args.familyId))
    .collect();

  for (let i = 0; i < args.slots.length; i++) {
    const slot = args.slots[i];
    const candidate = {
      familyId: args.familyId,
      id: `scheduling-candidate-${i}`,
      clientId: `scheduling-candidate-${i}`,
      startDate: slot.startDate,
      endDate: slot.endDate,
      allDay: false,
      resourceId: args.resourceId,
    };

    const overlappingEvent = events.find((event: any) =>
      event.status !== "cancelled" &&
      eventOverlapsCaregiverRange(event, { startDate: slot.startDate, endDate: slot.endDate }) &&
      (!args.resourceId || event.resourceId === args.resourceId)
    );
    if (overlappingEvent) {
      throw new ConvexError({ code: "SCHEDULING_SLOT_CONFLICT", message: "Ein vorgeschlagener Zeitslot kollidiert mit einem bestehenden Termin." });
    }

    const siblingConflict = findResourceConflict({
      candidate: { ...candidate, resourceId: args.resourceId ?? `family-slot-${i}` },
      existingEvents: args.slots.slice(0, i).map((existing, index) => ({
        id: `scheduling-candidate-${index}`,
        clientId: `scheduling-candidate-${index}`,
        startDate: existing.startDate,
        endDate: existing.endDate,
        allDay: false,
        resourceId: args.resourceId ?? `family-slot-${i}`,
      })),
    });
    if (siblingConflict.conflict) {
      throw new ConvexError({ code: "SCHEDULING_SLOT_CONFLICT", message: "Die vorgeschlagenen Zeitslots überschneiden sich." });
    }
  }
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
    isPrivate: v.optional(v.boolean()),
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

    if (!user) {
      throw new ConvexError({ code: "USER_NOT_FOUND", message: "Benutzer nicht gefunden." });
    }
    if (user.familyId !== args.familyId) {
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
      isPrivate: args.isPrivate,
      vetoStatus: args.vetoStatus,
      vetoReason: args.vetoReason,
      vetoChildId: args.vetoChildId,
      status: args.status,
      resourceId: args.resourceId,
      updatedAt: now,
    };

    const existingByServerId = args.serverId ? await ctx.db.get(args.serverId) : null;
    assertEventBelongsToFamily(existingByServerId, args.familyId);
    const existingByClientId = await ctx.db
      .query("calendarEvents")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .filter((q) => q.eq(q.field("familyId"), args.familyId))
      .first();
    const existing = existingByServerId ?? existingByClientId;

    let resourceId = existing ? existing.resourceId : args.resourceId;
    let resourceName: string | undefined;
    if (resourceId) {
      const resource = await ctx.db.get(resourceId);
      if (!resource || resource.familyId !== args.familyId) {
        throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED", message: "Die Ressource gehört nicht zu deiner Familie." });
      }
      if (resource.type !== "resource") {
        throw new ConvexError({ code: "INVALID_RESOURCE", message: "Diese Auswahl ist keine buchbare Ressource." });
      }
      resourceName = resource.name;
    }

    if (existing) {
      const previousStatus = existing.status;
      const { record, mergedFields } = mergeCalendarEventFields(
        localRecord,
        existing,
        args.locallyChangedFields ?? [],
      );
      validateVetoFieldChange(user as any, existing, record);
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
        isPrivate: record.isPrivate as boolean | undefined,
        vetoStatus: record.vetoStatus as string | undefined,
        vetoReason: record.vetoReason as string | undefined,
        vetoChildId: record.vetoChildId as string | undefined,
        status: record.status as string | undefined,
        resourceId: record.resourceId as typeof args.resourceId,
        updatedAt: now,
      };
      const vetoStatusChanged = existing.vetoStatus !== patch.vetoStatus;

      if (confirmsDraft && existing.creatorId === "scheduling-agent" && typeof existing.clientId === "string") {
        patch.title = patch.title.replace(/^\[Vorschlag\]\s*/, "");
        const batchId = existing.clientId.replace(/-\d+$/, "");
        for (let i = 1; i <= 3; i++) {
          const siblingClientId = `${batchId}-${i}`;
          const sibling = await ctx.db
            .query("calendarEvents")
            .withIndex("by_clientId", (q: any) => q.eq("clientId", siblingClientId))
            .filter((q: any) => q.eq(q.field("familyId"), args.familyId))
            .first();
          if (sibling && sibling._id !== existing._id) {
            await ctx.db.delete(sibling._id);
          }
        }
      }

      assertValidDateRange(patch.startDate, patch.endDate);
      const resourceConflict = await detectResourceConflict(ctx, { ...patch, id: String(existing._id), clientId: patch.clientId }, existing._id);
      const canBypassResourceConflict = assertRoleCanBypassResourceConflict(user, resourceConflict);
      await ctx.db.patch(existing._id, patch);

      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "calendar_event",
        entityType: "calendarEvent",
        entityId: String(existing._id),
        summary: confirmsDraft ? "Terminvorschlag bestätigt" : "Kalendertermin aktualisiert",
        createdAt: now,
      });

      if (vetoStatusChanged) {
        if (patch.vetoStatus === "vetoed") {
          const vetoChildUser = await ctx.db
            .query("users")
            .withIndex("by_clerkId", (q) => q.eq("clerkId", patch.vetoChildId ?? userId))
            .first();
          await recordActivity(ctx, {
            familyId: args.familyId,
            actorId: userId,
            type: "event_comment",
            entityType: "calendarEvent",
            entityId: String(existing._id),
            summary: `Einspruch von ${vetoChildUser?.name ?? "Kind"} erhoben`,
            createdAt: now,
          });
        } else if (existing.vetoStatus === "vetoed" && !patch.vetoStatus) {
          await recordActivity(ctx, {
            familyId: args.familyId,
            actorId: userId,
            type: "event_comment",
            entityType: "calendarEvent",
            entityId: String(existing._id),
            summary: "Einspruch für Termin zurückgesetzt",
            createdAt: now,
          });
        }
      }
      if (canBypassResourceConflict && resourceConflict) {
        await ctx.scheduler.runAfter(0, (internal as any).agents.triggerConflictAgent, {
          familyId: args.familyId,
          createdBy: userId,
          eventAId: existing._id,
          eventBId: resourceConflict.event.id as any,
          resourceName,
        });
      }
      await ctx.scheduler.runAfter(0, (internal as any).agents.archiveResolvedConflictThreads, { familyId: args.familyId });
      const serverRecord = await ctx.db.get(existing._id);
      return { serverId: existing._id, serverRecord, mergedFields };
    }

    validateVetoFieldChange(user as any, {}, localRecord);
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

    if (localRecord.vetoStatus === "vetoed") {
      const vetoChildUser = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", localRecord.vetoChildId ?? userId))
        .first();
      await recordActivity(ctx, {
        familyId: args.familyId,
        actorId: userId,
        type: "event_comment",
        entityType: "calendarEvent",
        entityId: String(eventId),
        summary: `Einspruch von ${vetoChildUser?.name ?? "Kind"} erhoben`,
        createdAt: now,
      });
    }
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
        resourceName,
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

  if (!user) {
    throw new ConvexError({ code: "USER_NOT_FOUND", message: "Benutzer nicht gefunden." });
  }

  const event = await ctx.db.get(args.eventId);
  if (!event || event.familyId !== args.familyId) {
    throw new ConvexError({ code: "EVENT_ACCESS_DENIED", message: "Dieser Termin gehört nicht zu deiner Familie." });
  }
  if (user.familyId !== args.familyId) {
    throw new ConvexError({ code: "FAMILY_ACCESS_DENIED", message: "Du bist kein Mitglied dieser Familie." });
  }

  // Check permissions: Parent or Owner can delete any event. Creator can delete their own event.
  const isParentOrOwner = PARENT_OR_OWNER_ROLES.has(user.role ?? "");
  const isCreator = event.creatorId === userId;
  if (!isParentOrOwner && !isCreator) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Du hast keine Berechtigung, diesen Termin zu löschen." });
  }

  // If deleting a caregiver or scheduling suggestion draft, assert isParentOrOwner
  const isCaregiverOrSchedulingDraft = event.status === "draft" && (event.creatorId === "caregiver" || event.creatorId === "scheduling-agent");
  if (isCaregiverOrSchedulingDraft && !isParentOrOwner) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Nur Eltern oder Familieninhaber dürfen Terminvorschläge verwalten." });
  }

  const now = Date.now();
  await ctx.db.delete(args.eventId);
  await recordActivity(ctx as any, {
    familyId: args.familyId,
    actorId: userId,
    type: "calendar_event",
    entityType: "calendarEvent",
    entityId: String(args.eventId),
    summary: event.status === "draft" ? "Terminvorschlag abgelehnt" : "Kalendertermin gelöscht",
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

  if (!user) {
    throw new ConvexError({ code: "USER_NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
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
  if (event.vetoStatus === "vetoed" && event.vetoChildId !== userId) {
    throw new ConvexError({ code: "INSUFFICIENT_PERMISSIONS", message: "Dieser Termin hat bereits einen Einspruch von einem anderen Kind." });
  }

  const reason = args.reason.trim();
  if (!reason) {
    throw new ConvexError({ code: "INVALID_VETO_REASON", message: "Bitte gib einen kurzen Grund für den Einspruch an." });
  }
  if (reason.length > 500) {
    throw new ConvexError({ code: "INVALID_VETO_REASON", message: "Der Grund für den Einspruch darf maximal 500 Zeichen lang sein." });
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
  if (event.vetoStatus !== "vetoed") {
    throw new ConvexError({ code: "NO_ACTIVE_VETO", message: "Kein aktiver Einspruch vorhanden." });
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

export const createDraftSuggestionsFromAgent = internalMutation({
  args: {
    familyId: v.id("families"),
    requestedTitle: v.string(),
    slots: v.array(v.object({ startDate: v.string(), endDate: v.string() })),
    resourceId: v.optional(v.id("virtualMembers")),
    schedulingBatchId: v.optional(v.string()),
    requestedByUserId: v.string(),
  },
  handler: async (ctx, args) => createDraftSuggestionsHandler(ctx as any, args),
});

export const listEventsForCaregiver = query({
  args: {
    familyId: v.id("families"),
    startDate: v.string(),
    endDate: v.string(),
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

    return events
      .filter((event: any) => eventOverlapsCaregiverRange(event, { startDate: args.startDate, endDate: args.endDate }))
      .map(sanitizeCaregiverEvent);
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
