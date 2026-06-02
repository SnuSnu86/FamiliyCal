import { strict as assert } from "node:assert";

import {
  expandCalendarEventOccurrences,
  type RecurrenceInput,
} from "./recurrence";

const baseEvent = (overrides: Partial<RecurrenceInput> = {}): RecurrenceInput => ({
  id: "event-1",
  title: "Training",
  startDate: "2026-03-23T08:00:00.000Z",
  endDate: "2026-03-23T09:00:00.000Z",
  timezoneId: "Europe/Berlin",
  ...overrides,
});

const sixMonths = {
  startDate: "2026-03-01T00:00:00.000Z",
  endDate: "2026-09-01T00:00:00.000Z",
};

function localHour(iso: string, timezoneId = "Europe/Berlin"): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: timezoneId,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function validIso(iso: string): boolean {
  return !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString() === iso;
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=WEEKLY;COUNT=4" }),
    sixMonths,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 4);
  assert.deepEqual(result.occurrences.map((occurrence) => localHour(occurrence.startDate)), ["09:00", "09:00", "09:00", "09:00"]);
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.startDate), [
    "2026-03-23T08:00:00.000Z",
    "2026-03-30T07:00:00.000Z",
    "2026-04-06T07:00:00.000Z",
    "2026-04-13T07:00:00.000Z",
  ]);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({
      startDate: "2026-10-12T07:00:00.000Z",
      endDate: "2026-10-12T08:00:00.000Z",
      rrule: "FREQ=WEEKLY;COUNT=5",
    }),
    { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z" },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.occurrences.map((occurrence) => localHour(occurrence.startDate)), ["09:00", "09:00", "09:00", "09:00", "09:00"]);
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.startDate), [
    "2026-10-12T07:00:00.000Z",
    "2026-10-19T07:00:00.000Z",
    "2026-10-26T08:00:00.000Z",
    "2026-11-02T08:00:00.000Z",
    "2026-11-09T08:00:00.000Z",
  ]);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=DAILY;COUNT=3" }),
    sixMonths,
  );

  assert.equal(result.occurrences.length, 3);
  assert.deepEqual(result.occurrences.map((occurrence) => localHour(occurrence.startDate)), ["09:00", "09:00", "09:00"]);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=MONTHLY;COUNT=2" }),
    sixMonths,
  );

  assert.equal(result.occurrences.length, 2);
  assert.deepEqual(result.occurrences.map((occurrence) => localHour(occurrence.startDate)), ["09:00", "09:00"]);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=WEEKLY;UNTIL=20260406T000000Z" }),
    sixMonths,
  );

  assert.equal(result.occurrences.length, 2);
  assert.deepEqual(result.occurrences.map((occurrence) => localHour(occurrence.startDate)), ["09:00", "09:00"]);
}

{
  const result = expandCalendarEventOccurrences(baseEvent(), {
    startDate: "2026-03-23T08:30:00.000Z",
    endDate: "2026-03-23T08:45:00.000Z",
  });

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0]?.occurrenceKey, "event-1:2026-03-23T08:00:00.000Z");
}

{
  const result = expandCalendarEventOccurrences(baseEvent({ rrule: "FREQ=NOTREAL" }), sixMonths);

  assert.equal(result.occurrences.length, 0);
  assert.equal(result.error?.code, "INVALID_RRULE");
  assert.equal(result.error?.message, "Die Wiederholungsregel ist ungültig. Bitte prüfe Rhythmus und Enddatum.");
}

{
  const result = expandCalendarEventOccurrences(baseEvent({ timezoneId: "Mars/Olympus", rrule: "FREQ=WEEKLY;COUNT=2" }), sixMonths);

  assert.equal(result.occurrences.length, 0);
  assert.equal(result.error?.code, "INVALID_TIMEZONE");
}

{
  const input = baseEvent({
    floatingTime: true,
    timezoneId: undefined,
    rrule: "FREQ=WEEKLY;COUNT=2",
  });
  const result = expandCalendarEventOccurrences(input, sixMonths);

  assert.equal(result.error, undefined);
  assert.equal(input.timezoneId, undefined);
  assert.equal(result.occurrences.length, 2);
  assert.ok(result.occurrences.every((occurrence) => occurrence.floatingTime === true));
  assert.ok(result.occurrences.every((occurrence) => validIso(occurrence.startDate) && validIso(occurrence.endDate)));
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.startDate), [
    "2026-03-23T08:00:00.000Z",
    "2026-03-30T08:00:00.000Z",
  ]);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=DAILY" }),
    { startDate: "2026-03-01T00:00:00.000Z", endDate: "2027-03-01T00:00:00.000Z" },
  );

  assert.equal(result.error, undefined);
  assert.ok(result.occurrences.length <= 184);
  const lastOccurrence = result.occurrences.at(-1);
  assert.ok(lastOccurrence);
  assert.equal(lastOccurrence.startDate < "2026-09-01T00:00:00.000Z", true);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({
      startDate: "2026-12-24T08:00:00.000Z",
      endDate: "2026-12-24T09:00:00.000Z",
    }),
    { startDate: "2026-03-01T00:00:00.000Z", endDate: "2027-03-01T00:00:00.000Z" },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0]?.startDate, "2026-12-24T08:00:00.000Z");
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({ rrule: "FREQ=SECONDLY" }),
    { startDate: "2026-03-23T08:00:00.000Z", endDate: "2026-04-23T08:00:00.000Z" },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 1000);
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({
      startDate: "2026-03-23T08:00:00.000Z",
      endDate: "2026-03-25T08:00:00.000Z",
      rrule: "FREQ=WEEKLY;COUNT=2",
    }),
    { startDate: "2026-03-24T00:00:00.000Z", endDate: "2026-03-24T23:59:59.999Z" },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0]?.startDate, "2026-03-23T08:00:00.000Z");
}

{
  const result = expandCalendarEventOccurrences(
    baseEvent({
      allDay: true,
      startDate: "2026-10-25T22:00:00.000Z",
      endDate: "2026-10-26T23:00:00.000Z",
      rrule: "FREQ=WEEKLY;COUNT=2",
    }),
    { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-11-30T00:00:00.000Z" },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.occurrences.length, 2);
  assert.deepEqual(
    result.occurrences.map((occurrence) => [localHour(occurrence.startDate), localHour(occurrence.endDate)]),
    [
      ["23:00", "00:00"],
      ["23:00", "00:00"],
    ],
  );
}
