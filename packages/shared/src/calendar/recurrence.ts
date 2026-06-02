import * as rrulePackage from "rrule";
import { DateTime } from "luxon";

const rruleExports = ("rrulestr" in rrulePackage ? rrulePackage : (rrulePackage as { default: typeof rrulePackage }).default) as typeof rrulePackage;
const { rrulestr } = rruleExports;

export type RecurrenceInput = {
  id: string;
  title?: string;
  startDate: string;
  endDate: string;
  allDay?: boolean | null;
  rrule?: string | null;
  timezoneId?: string | null;
  floatingTime?: boolean | null;
  [key: string]: unknown;
};

export type RecurrenceExpansionWindow = {
  startDate: string;
  endDate: string;
};

export type RecurrenceValidationErrorCode = "INVALID_DATE" | "INVALID_RRULE" | "INVALID_TIMEZONE";

export type RecurrenceValidationError = {
  code: RecurrenceValidationErrorCode;
  message: string;
};

export type ExpandedOccurrence<T extends RecurrenceInput = RecurrenceInput> = T & {
  occurrenceKey: string;
  originalEventId: string;
  startDate: string;
  endDate: string;
};

export type RecurrenceExpansionResult<T extends RecurrenceInput = RecurrenceInput> = {
  occurrences: ExpandedOccurrence<T>[];
  error?: RecurrenceValidationError;
};

const MAX_EXPANSION_MONTHS = 6;
const MAX_OCCURRENCES_PER_EXPANSION = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_RRULE_MESSAGE = "Die Wiederholungsregel ist ungültig. Bitte prüfe Rhythmus und Enddatum.";
const INVALID_TIMEZONE_MESSAGE = "Die Zeitzone ist ungültig. Bitte wähle eine gültige Zeitzone.";
const INVALID_DATE_MESSAGE = "Das Datum ist ungültig. Bitte prüfe Start und Ende.";

export function expandCalendarEventOccurrences<T extends RecurrenceInput>(
  event: T,
  window: RecurrenceExpansionWindow,
): RecurrenceExpansionResult<T> {
  const start = DateTime.fromISO(event.startDate, { zone: "utc" });
  const end = DateTime.fromISO(event.endDate, { zone: "utc" });
  const windowStart = DateTime.fromISO(window.startDate, { zone: "utc" });
  const requestedWindowEnd = DateTime.fromISO(window.endDate, { zone: "utc" });

  if (![start, end, windowStart, requestedWindowEnd].every((date) => date.isValid) || end <= start || requestedWindowEnd <= windowStart) {
    return errorResult<T>("INVALID_DATE", INVALID_DATE_MESSAGE);
  }

  if (!event.rrule) {
    return intersects(start, end, windowStart, requestedWindowEnd) ? { occurrences: [buildOccurrence(event, start, end)] } : { occurrences: [] };
  }

  const windowEnd = DateTime.min(requestedWindowEnd, windowStart.plus({ months: MAX_EXPANSION_MONTHS }));
  const zone = event.floatingTime ? "utc" : event.timezoneId;
  if (!zone || !DateTime.local().setZone(zone).isValid) {
    return errorResult<T>("INVALID_TIMEZONE", INVALID_TIMEZONE_MESSAGE);
  }

  const localStart = start.setZone(zone);
  const localEnd = end.setZone(zone);
  if (!localStart.isValid) {
    return errorResult<T>("INVALID_TIMEZONE", INVALID_TIMEZONE_MESSAGE);
  }
  const wallDuration = localEnd.diff(localStart, ["days", "hours", "minutes", "seconds", "milliseconds"]);
  const lookbackDays = Math.max(1, Math.ceil((end.toMillis() - start.toMillis()) / DAY_MS));

  let rule: { between: (after: Date, before: Date, inc?: boolean, iterator?: (date: Date, index: number) => boolean) => Date[] };
  try {
    rule = rrulestr(event.rrule, { dtstart: toFloatingRuleDate(localStart) }) as { between: (after: Date, before: Date, inc?: boolean, iterator?: (date: Date, index: number) => boolean) => Date[] };
  } catch {
    return errorResult<T>("INVALID_RRULE", INVALID_RRULE_MESSAGE);
  }

  try {
    const ruleWindowStart = toFloatingRuleDate(windowStart.setZone(zone).minus({ days: lookbackDays }));
    const ruleWindowEnd = toFloatingRuleDate(windowEnd.setZone(zone).plus({ days: 1 }));
    const dates = rule.between(ruleWindowStart, ruleWindowEnd, true, (_date, index) => index < MAX_OCCURRENCES_PER_EXPANSION);
    const occurrences = dates
      .map((date: Date) => fromRuleDate(date, zone))
      .map((occurrenceStart: DateTime) => buildOccurrence(event, occurrenceStart, occurrenceStart.plus(wallDuration)))
      .filter((occurrence: ExpandedOccurrence<T>) => isEventInUtcRange(occurrence.startDate, occurrence.endDate, windowStart, windowEnd));

    return { occurrences };
  } catch {
    return errorResult<T>("INVALID_RRULE", INVALID_RRULE_MESSAGE);
  }
}

function buildOccurrence<T extends RecurrenceInput>(event: T, start: DateTime, end: DateTime): ExpandedOccurrence<T> {
  const utcStart = start.toUTC();
  const utcEnd = end.toUTC();
  const startDate = utcStart.toISO({ suppressMilliseconds: false });
  const endDate = utcEnd.toISO({ suppressMilliseconds: false });

  if (!startDate || !endDate) throw new Error("Invalid occurrence date");

  return {
    ...event,
    id: event.id,
    originalEventId: event.id,
    occurrenceKey: `${event.id}:${startDate}`,
    startDate,
    endDate,
  };
}

function intersects(start: DateTime, end: DateTime, rangeStart: DateTime, rangeEnd: DateTime): boolean {
  return start < rangeEnd && end > rangeStart;
}

function isEventInUtcRange(startDate: string, endDate: string, rangeStart: DateTime, rangeEnd: DateTime): boolean {
  return intersects(DateTime.fromISO(startDate, { zone: "utc" }), DateTime.fromISO(endDate, { zone: "utc" }), rangeStart, rangeEnd);
}

function toFloatingRuleDate(date: DateTime): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute, date.second, date.millisecond));
}

function fromRuleDate(date: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      millisecond: date.getUTCMilliseconds(),
    },
    { zone },
  );
}

function errorResult<T extends RecurrenceInput>(code: RecurrenceValidationErrorCode, message: string): RecurrenceExpansionResult<T> {
  return { occurrences: [], error: { code, message } };
}
