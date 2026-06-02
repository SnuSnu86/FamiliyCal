import { expandCalendarEventOccurrences } from "@packages/shared";

export type CalendarView = "month" | "week" | "day" | "agenda";

export type CalendarViewEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  rrule?: string | null;
  timezoneId?: string | null;
  floatingTime?: boolean | null;
  occurrenceKey?: string;
  originalEventId?: string;
  recurrenceErrorMessage?: string;
};

export type VisibleRange = { start: string; end: string };

export type CalendarEventGroup<T extends CalendarViewEvent = CalendarViewEvent> = {
  dateKey: string;
  label: string;
  events: T[];
};

export function getVisibleRange(view: CalendarView, focusedDate: Date): VisibleRange {
  if (Number.isNaN(focusedDate.getTime())) {
    return toRange(startOfLocalDay(new Date()), addLocalDays(startOfLocalDay(new Date()), 1));
  }

  const startOfFocusDay = startOfLocalDay(focusedDate);

  if (view === "day") {
    return toRange(startOfFocusDay, addLocalDays(startOfFocusDay, 1));
  }

  if (view === "week") {
    const day = startOfFocusDay.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = addLocalDays(startOfFocusDay, mondayOffset);
    return toRange(start, addLocalDays(start, 7));
  }

  if (view === "agenda") {
    return toRange(startOfFocusDay, addLocalDays(startOfFocusDay, 30));
  }

  const monthGridStart = getMonthGridStart(focusedDate);
  return toRange(monthGridStart, addLocalDays(monthGridStart, 42));
}

export function isEventInRange(event: CalendarViewEvent, range: VisibleRange): boolean {
  const eventStart = Date.parse(event.startDate);
  const eventEnd = Date.parse(event.endDate);
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);

  if ([eventStart, eventEnd, rangeStart, rangeEnd].some(Number.isNaN)) {
    return false;
  }

  return eventStart < rangeEnd && eventEnd > rangeStart;
}

export function groupEventsForView<T extends CalendarViewEvent>(
  events: T[],
  view: CalendarView,
  focusedDate: Date,
): CalendarEventGroup<T>[] {
  const range = getVisibleRange(view, focusedDate);
  const expandedEvents = events.flatMap((event) => {
    const { occurrences, error } = expandCalendarEventOccurrences(event, { startDate: range.start, endDate: range.end });
    if (error) {
      return isEventInRange(event, range) ? [cloneWithRecurrenceError(event, error.message)] : [];
    }
    // Non-recurring events keep their original (reactive) instance so display fields such
    // as title/serverId survive — spreading a WatermelonDB model would drop its accessor
    // getters. Recurring events get per-occurrence clones that still resolve those getters
    // via the source prototype while carrying their own occurrence dates.
    if (!event.rrule) {
      return occurrences.length > 0 ? [event] : [];
    }
    return occurrences.map((occurrence) => cloneWithOccurrenceDates(event, occurrence));
  });
  const sortedEvents = expandedEvents
    .filter((event) => isEventInRange(event, range))
    .slice()
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate));

  const groups = new Map<string, T[]>();
  for (const event of sortedEvents) {
    const dateKey = getEventDateKey(event, range);
    groups.set(dateKey, [...(groups.get(dateKey) ?? []), event]);
  }

  return Array.from(groups.entries()).map(([dateKey, groupedEvents]) => ({
    dateKey,
    label: formatDateLabel(dateKey),
    events: groupedEvents,
  }));
}

// Buckets an event into a day key, clamping events that start before the visible range to
// the range start so multi-day events overlapping the window stay visible in grid views.
export function getEventDateKey(event: CalendarViewEvent, range: VisibleRange): string {
  const startMs = Date.parse(event.startDate);
  const rangeStartMs = Date.parse(range.start);
  const effectiveMs = Number.isNaN(startMs) ? rangeStartMs : Math.max(startMs, rangeStartMs);
  return toDateKey(new Date(effectiveMs), event.floatingTime ? undefined : event.timezoneId);
}

// Stable identity for a (possibly recurring) occurrence. Expanded recurring occurrences
// share the base event id, so the occurrenceKey must be preferred for React keys/selection.
export function getOccurrenceKey(event: CalendarViewEvent): string {
  return event.occurrenceKey ?? event.id;
}

function cloneWithOccurrenceDates<T extends CalendarViewEvent>(
  source: T,
  occurrence: { startDate: string; endDate: string; occurrenceKey: string; originalEventId: string },
): T {
  return Object.assign(Object.create(source as object), {
    startDate: occurrence.startDate,
    endDate: occurrence.endDate,
    occurrenceKey: occurrence.occurrenceKey,
    originalEventId: occurrence.originalEventId,
  }) as T;
}

function cloneWithRecurrenceError<T extends CalendarViewEvent>(source: T, recurrenceErrorMessage: string): T {
  return Object.assign(Object.create(source as object), { recurrenceErrorMessage }) as T;
}

export function getMonthGridDays(focusedDate: Date): string[] {
  const gridStart = getMonthGridStart(focusedDate);
  return Array.from({ length: 42 }, (_, index) => toDateKey(addLocalDays(gridStart, index)));
}

export function getWeekDays(focusedDate: Date): string[] {
  const range = getVisibleRange("week", focusedDate);
  const start = new Date(range.start);
  return Array.from({ length: 7 }, (_, index) => toDateKey(addLocalDays(start, index)));
}

export function toDateKey(date: Date, timezoneId?: string | null): string {
  if (timezoneId) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneId,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function getMonthGridStart(focusedDate: Date): Date {
  const monthStart = new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1);
  const day = monthStart.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addLocalDays(monthStart, mondayOffset);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toRange(start: Date, end: Date): VisibleRange {
  return { start: start.toISOString(), end: end.toISOString() };
}
