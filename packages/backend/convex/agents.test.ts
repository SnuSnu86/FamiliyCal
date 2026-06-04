import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import { conflictCooldownMs, eventsStillConflict } from "./agents";
import { assertRoleCanBypassResourceConflict } from "./calendarEvents";

describe("conflict agent role handling", () => {
  const conflict = { event: { id: "event-b" } };

  test("allows parents and owners to bypass resource conflicts", () => {
    expect(assertRoleCanBypassResourceConflict({ role: "ROLE-001" }, conflict)).toBe(true);
    expect(assertRoleCanBypassResourceConflict({ role: "ROLE-002" }, conflict)).toBe(true);
  });

  test("blocks children on resource conflicts", () => {
    expect(() => assertRoleCanBypassResourceConflict({ role: "ROLE-004" }, conflict)).toThrow(ConvexError);
  });
});

describe("conflict agent cooldown", () => {
  test("uses 2 minutes for conflicts within the next 24 hours", () => {
    const now = Date.parse("2026-06-04T10:00:00.000Z");
    expect(
      conflictCooldownMs(
        now,
        { startDate: "2026-06-04T12:00:00.000Z" },
        { startDate: "2026-06-10T12:00:00.000Z" },
      ),
    ).toBe(2 * 60 * 1000);
  });

  test("uses 15 minutes for future conflicts", () => {
    const now = Date.parse("2026-06-04T10:00:00.000Z");
    expect(
      conflictCooldownMs(
        now,
        { startDate: "2026-06-06T12:00:00.000Z" },
        { startDate: "2026-06-06T12:30:00.000Z" },
      ),
    ).toBe(15 * 60 * 1000);
  });
});

describe("resolved conflict cleanup", () => {
  test("detects that moving an event resolves the resource conflict", () => {
    const eventA = {
      _id: "event-a",
      clientId: "event-a-client",
      startDate: "2026-06-04T10:00:00.000Z",
      endDate: "2026-06-04T11:00:00.000Z",
      resourceId: "car-1",
    };
    const movedEventB = {
      _id: "event-b",
      clientId: "event-b-client",
      startDate: "2026-06-04T12:00:00.000Z",
      endDate: "2026-06-04T13:00:00.000Z",
      resourceId: "car-1",
    };

    expect(eventsStillConflict(eventA, movedEventB)).toBe(false);
  });

  test("detects that deleting one side resolves the resource conflict", () => {
    expect(eventsStillConflict({ _id: "event-a", resourceId: "car-1" }, null)).toBe(false);
  });
});
