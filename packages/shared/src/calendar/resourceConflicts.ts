import { DateTime } from "luxon";

import {
  expandCalendarEventOccurrences,
  type ExpandedOccurrence,
  type RecurrenceInput,
  type RecurrenceValidationError,
} from "./recurrence";

export type ResourceConflictEvent = RecurrenceInput & {
  clientId?: string | null;
  resourceId?: string | null;
};

export type ResourceConflict = {
  event: ResourceConflictEvent;
  occurrence: ExpandedOccurrence<ResourceConflictEvent>;
  candidateOccurrence: ExpandedOccurrence<ResourceConflictEvent>;
};

export type ResourceConflictResult = {
  conflict?: ResourceConflict;
  error?: RecurrenceValidationError;
};

type Interval = {
  startDate: string;
  endDate: string;
};

const MAX_CONFLICT_WINDOW_MONTHS = 6;

export function hasIntervalOverlap(candidate: Interval, existing: Interval): boolean {
  return candidate.startDate < existing.endDate && candidate.endDate > existing.startDate;
}

export function findResourceConflict({
  candidate,
  existingEvents,
}: {
  candidate: ResourceConflictEvent;
  existingEvents: ResourceConflictEvent[];
}): ResourceConflictResult {
  const window = buildConflictWindow(candidate);
  if (!window) {
    return {
      error: { code: "INVALID_DATE", message: "Das Datum ist ungültig. Bitte prüfe Start und Ende." },
    };
  }

  const candidateExpansion = expandCalendarEventOccurrences(candidate, window);
  if (candidateExpansion.error) return { error: candidateExpansion.error };

  for (const existing of existingEvents) {
    if (isSameEvent(candidate, existing)) continue;

    const existingExpansion = expandCalendarEventOccurrences(existing, window);
    if (existingExpansion.error) return { error: existingExpansion.error };

    for (const candidateOccurrence of candidateExpansion.occurrences) {
      for (const existingOccurrence of existingExpansion.occurrences) {
        if (hasIntervalOverlap(candidateOccurrence, existingOccurrence)) {
          return {
            conflict: {
              event: existing,
              occurrence: existingOccurrence,
              candidateOccurrence,
            },
          };
        }
      }
    }
  }

  return {};
}

function buildConflictWindow(candidate: ResourceConflictEvent): { startDate: string; endDate: string } | null {
  const start = DateTime.fromISO(candidate.startDate, { zone: "utc" });
  const end = DateTime.fromISO(candidate.endDate, { zone: "utc" });
  if (!start.isValid || !end.isValid || end <= start) return null;

  const windowEnd = DateTime.max(end, start.plus({ months: MAX_CONFLICT_WINDOW_MONTHS }));
  const startDate = start.toUTC().toISO({ suppressMilliseconds: false });
  const endDate = windowEnd.toUTC().toISO({ suppressMilliseconds: false });
  return startDate && endDate ? { startDate, endDate } : null;
}

function isSameEvent(candidate: ResourceConflictEvent, existing: ResourceConflictEvent): boolean {
  if (candidate.id && existing.id) return candidate.id === existing.id;
  return Boolean(candidate.clientId && existing.clientId && candidate.clientId === existing.clientId);
}
