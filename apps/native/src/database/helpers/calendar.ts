import type Database from "@nozbe/watermelondb/Database";

import { CalendarEvent } from "../models/CalendarEvent";

export type CreateLocalEventInput = {
  family_id: string;
  creator_id?: string;
  title: string;
  description?: string;
  start_date: string;
  end_date?: string;
  all_day?: boolean;
  rrule?: string;
  timezone_id?: string;
  floating_time?: boolean;
  veto_status?: string;
  veto_reason?: string;
  veto_child_id?: string;
  status?: string;
  resource_id?: string;
};

function toIsoUtc(isoDate: string): string {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Ungültiges Datum: ${isoDate}`);
  }
  return new Date(time).toISOString();
}

export function addHoursAsIsoUtc(isoDate: string, hours: number): string {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Ungültiges Datum: ${isoDate}`);
  }
  return new Date(time + hours * 60 * 60 * 1000).toISOString();
}

export async function createLocalEvent(
  db: Database,
  eventData: CreateLocalEventInput,
): Promise<CalendarEvent> {
  const startDate = toIsoUtc(eventData.start_date);
  const endDate = eventData.end_date ? toIsoUtc(eventData.end_date) : addHoursAsIsoUtc(eventData.start_date, 1);
  const events = db.collections.get<CalendarEvent>("calendar_events");

  return db.write(async () =>
    events.create((event: CalendarEvent) => {
      // server_id stays null until the sync engine (story 2.2b) assigns a remote id.
      event.serverId = null;
      event.familyId = eventData.family_id;
      event.creatorId = eventData.creator_id;
      event.title = eventData.title;
      event.description = eventData.description;
      event.startDate = startDate;
      event.endDate = endDate;
      event.allDay = eventData.all_day ?? false;
      event.rrule = eventData.rrule;
      event.timezoneId = eventData.timezone_id;
      event.floatingTime = eventData.floating_time ?? false;
      event.vetoStatus = eventData.veto_status;
      event.vetoReason = eventData.veto_reason;
      event.vetoChildId = eventData.veto_child_id;
      event.status = eventData.status ?? "confirmed";
      event.resourceId = eventData.resource_id;
    }),
  );
}
