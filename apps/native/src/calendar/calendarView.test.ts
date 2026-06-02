import { getVisibleRange, groupEventsForView, isEventInRange, type CalendarViewEvent } from "./calendarView";

const event = (id: string, startDate: string, endDate: string): CalendarViewEvent => ({
  id,
  title: id,
  startDate,
  endDate,
});

describe("calendar view helpers", () => {
  it("computes UTC ranges for month, week, day and agenda", () => {
    const focus = new Date("2026-06-17T12:00:00.000Z");

    // Month range spans the 42-day (6-week) Monday-start grid so events in the visible
    // leading/trailing cells of adjacent months are included rather than silently dropped.
    expect(getVisibleRange("month", focus).start).toBe(new Date(2026, 5, 1).toISOString());
    expect(getVisibleRange("month", focus).end).toBe(new Date(2026, 6, 13).toISOString());
    expect(getVisibleRange("week", focus).start).toBe(new Date(2026, 5, 15).toISOString());
    expect(getVisibleRange("week", focus).end).toBe(new Date(2026, 5, 22).toISOString());
    expect(getVisibleRange("day", focus).start).toBe(new Date(2026, 5, 17).toISOString());
    expect(getVisibleRange("day", focus).end).toBe(new Date(2026, 5, 18).toISOString());
    expect(getVisibleRange("agenda", focus).start).toBe(new Date(2026, 5, 17).toISOString());
    expect(getVisibleRange("agenda", focus).end).toBe(new Date(2026, 6, 17).toISOString());
  });

  it("includes overlapping multi-day events and excludes outside events", () => {
    const range = { start: "2026-06-17T00:00:00.000Z", end: "2026-06-18T00:00:00.000Z" };

    expect(isEventInRange(event("multi", "2026-06-16T23:00:00.000Z", "2026-06-17T02:00:00.000Z"), range)).toBe(true);
    expect(isEventInRange(event("outside", "2026-06-18T00:00:00.000Z", "2026-06-18T01:00:00.000Z"), range)).toBe(false);
  });

  it("groups empty calendars without errors", () => {
    expect(groupEventsForView([], "week", new Date("2026-06-17T12:00:00.000Z"))).toEqual([]);
  });

  it("sorts and groups agenda events chronologically by UTC day", () => {
    const groups = groupEventsForView(
      [
        event("later", "2026-06-18T09:00:00.000Z", "2026-06-18T10:00:00.000Z"),
        event("earlier", "2026-06-17T08:00:00.000Z", "2026-06-17T09:00:00.000Z"),
      ],
      "agenda",
      new Date("2026-06-17T12:00:00.000Z"),
    );

    expect(groups.map((group) => group.dateKey)).toEqual(["2026-06-17", "2026-06-18"]);
    expect(groups[0]?.events.map((item) => item.id)).toEqual(["earlier"]);
  });

  it("expands recurring events for the visible week without duplicating the raw event", () => {
    const groups = groupEventsForView(
      [
        {
          ...event("training", "2026-03-23T08:00:00.000Z", "2026-03-23T09:00:00.000Z"),
          rrule: "FREQ=WEEKLY;COUNT=4",
          timezoneId: "Europe/Berlin",
        },
      ],
      "week",
      new Date("2026-03-31T12:00:00.000Z"),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.dateKey).toBe("2026-03-30");
    expect(groups[0]?.events).toHaveLength(1);
    expect(groups[0]?.events[0]?.id).toBe("training");
    expect(groups[0]?.events[0]?.occurrenceKey).toBe("training:2026-03-30T07:00:00.000Z");
  });

  it("keeps invalid recurring events out of calendar groups instead of throwing", () => {
    const groups = groupEventsForView(
      [
        {
          ...event("broken", "2026-03-23T08:00:00.000Z", "2026-03-23T09:00:00.000Z"),
          rrule: "FREQ=NOTREAL",
          timezoneId: "Europe/Berlin",
        },
      ],
      "month",
      new Date("2026-03-23T12:00:00.000Z"),
    );

    expect(groups[0]?.events[0]?.recurrenceErrorMessage).toBe("Die Wiederholungsregel ist ungültig. Bitte prüfe Rhythmus und Enddatum.");
  });

  it("groups timezone-aware events by their local day instead of their UTC day", () => {
    const groups = groupEventsForView(
      [
        {
          ...event("late", "2026-03-29T22:30:00.000Z", "2026-03-29T23:00:00.000Z"),
          timezoneId: "Europe/Berlin",
        },
      ],
      "week",
      new Date("2026-03-30T12:00:00.000Z"),
    );

    expect(groups[0]?.dateKey).toBe("2026-03-30");
  });
});
