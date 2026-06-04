import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import { buildCalendarEventSyncPayload, mergeCalendarEventFields } from "@packages/shared";
import type { CalendarEvent } from "../database/models/CalendarEvent";
import type { VirtualMember } from "../database/models/VirtualMember";

type CalendarDatabase = {
  collections: { get: (table: string) => { find?: (id: string) => Promise<VirtualMember>; query: (...conditions: unknown[]) => { fetch: () => Promise<CalendarEvent[]> }; deletedRecords?: Array<CalendarEvent & { destroyPermanently: () => Promise<void> }> } };
  write: (writer: () => Promise<void>) => Promise<void>;
};

type ConvexClientLike = {
  mutation: (mutationRef: any, payload: Record<string, unknown>) => Promise<{
    serverId: string;
    serverRecord?: Record<string, unknown> | null;
    mergedFields?: Record<string, string>;
  }>;
};

export type CalendarSyncResult = {
  synced: Array<{ localId: string; serverId: string }>;
  errors: Array<{ localId: string; error: unknown }>;
};

export async function syncPendingCalendarEvents({
  db,
  convexClient,
}: {
  db: CalendarDatabase;
  convexClient: ConvexClientLike;
}): Promise<CalendarSyncResult> {
  const collection = db.collections.get("calendar_events");
  const result: CalendarSyncResult = { synced: [], errors: [] };

  try {
    const deleted = collection.deletedRecords || [];
    for (const record of deleted) {
      try {
        if (record.serverId) {
          await convexClient.mutation(api.calendarEvents.deleteEvent, { eventId: record.serverId, familyId: record.familyId });
        }
        await record.destroyPermanently();
        result.synced.push({ localId: record.id, serverId: record.serverId ?? "deleted-local-only" });
      } catch (error) {
        console.warn("Calendar event delete sync failed", { localId: record.id, error });
        result.errors.push({ localId: record.id, error });
      }
    }
  } catch (error) {
    console.warn("Deleted calendar events sync failed", error);
  }

  const events = await collection
    .query(Q.or(Q.where("server_id", Q.eq(null)), Q.where("_status", Q.eq("updated"))))
    .fetch();

  for (const event of events) {
    try {
      const payload = buildCalendarEventSyncPayload(event as unknown as Record<string, unknown> & { id: string });
      await resolveResourceServerId(db, event, payload as Record<string, unknown>);
      const response = await convexClient.mutation(api.calendarEvents.syncCalendarEvent, payload);
      // Only a real server id is allowed to clear an event from the pending queue.
      // An empty/undefined response must keep the event pending for the next retry.
      if (!response.serverId) {
        throw new Error(`Calendar sync returned no serverId for local event ${event.id}`);
      }
      const serverRecord = response.serverRecord ?? { serverId: response.serverId };
      const { record } = mergeCalendarEventFields(
        payload,
        serverRecord,
        payload.locallyChangedFields,
      );

      await db.write(async () => {
        await event.update((localEvent: CalendarEvent) => {
          localEvent.serverId = response.serverId;
          assignCalendarEventFields(localEvent, record);
        });
      });

      result.synced.push({ localId: event.id, serverId: response.serverId });
    } catch (error) {
      console.warn("Calendar event sync failed", { localId: event.id, error });
      result.errors.push({ localId: event.id, error });
    }
  }

  return result;
}

async function resolveResourceServerId(
  db: CalendarDatabase,
  event: CalendarEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!event.resourceId || !("resourceId" in payload)) return;

  try {
    const collection = db.collections.get("virtual_members");
    const resource = collection.find ? await collection.find(event.resourceId) : null;
    if (resource?.serverId) payload.resourceId = resource.serverId;
  } catch {
    // If the local relation is missing, keep the original value so Convex rejects it
    // and the event remains pending with a sync error instead of losing local data.
  }
}

function assignCalendarEventFields(localEvent: CalendarEvent, record: Record<string, unknown>): void {
  const assignableFields: Array<keyof CalendarEvent & string> = [
    "familyId",
    "creatorId",
    "title",
    "description",
    "startDate",
    "endDate",
    "allDay",
    "rrule",
    "timezoneId",
    "floatingTime",
    "isPrivate",
    "vetoStatus",
    "vetoReason",
    "vetoChildId",
    "status",
    "resourceId",
  ];

  for (const field of assignableFields) {
    if (field in record && record[field] !== undefined) {
      (localEvent as unknown as Record<string, unknown>)[field] = record[field];
    }
  }
}
