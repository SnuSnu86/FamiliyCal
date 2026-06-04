import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import { assertCanRunSchedulingAgent, validateSchedulingSlots } from "./agents";
import { createDraftSuggestionsHandler, listEventsForSchedulingHandler, sanitizeSchedulingEvent } from "./calendarEvents";

describe("scheduling zero-knowledge filtering", () => {
  test("redacts private event details before scheduling", () => {
    expect(
      sanitizeSchedulingEvent({
        title: "Therapie",
        description: "Diagnose und Notizen",
        rrule: "FREQ=WEEKLY",
        comments: [{ body: "privat" }],
        notes: "nicht weitergeben",
        startDate: "2026-06-10T08:00:00.000Z",
        endDate: "2026-06-10T09:00:00.000Z",
        allDay: false,
        isPrivate: true,
      }),
    ).toEqual(
      expect.objectContaining({
        title: "Privater Termin",
        description: undefined,
        rrule: undefined,
        comments: undefined,
        notes: undefined,
        startDate: "2026-06-10T08:00:00.000Z",
        endDate: "2026-06-10T09:00:00.000Z",
        allDay: false,
      }),
    );
  });

  test("lists only overlapping family events and sanitizes private fields", async () => {
    const collect = jest.fn().mockResolvedValue([
      { _id: "before", familyId: "family-1", title: "Alt", startDate: "2026-06-01T08:00:00.000Z", endDate: "2026-06-01T09:00:00.000Z", allDay: false },
      { _id: "public", familyId: "family-1", title: "Schule", description: "Aula", startDate: "2026-06-10T08:00:00.000Z", endDate: "2026-06-10T09:00:00.000Z", allDay: false },
      { _id: "private", familyId: "family-1", title: "Arzt", description: "Befund", rrule: "FREQ=DAILY", private: true, comments: ["x"], startDate: "2026-06-11T08:00:00.000Z", endDate: "2026-06-11T09:00:00.000Z", allDay: false },
    ]);
    const ctx = {
      db: {
        query: jest.fn(() => ({ withIndex: jest.fn(() => ({ collect })) })),
      },
    };

    const result = await listEventsForSchedulingHandler(ctx as any, {
      familyId: "family-1" as any,
      startDate: "2026-06-10T00:00:00.000Z",
      endDate: "2026-06-12T00:00:00.000Z",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ title: "Schule", description: "Aula" }));
    expect(result[1]).toEqual(expect.objectContaining({ title: "Privater Termin", description: undefined, rrule: undefined, comments: undefined }));
  });
});

describe("scheduling draft creation", () => {
  test("creates exactly 3 draft suggestions with scheduling metadata", async () => {
    const inserted: any[] = [];
    const ctx = {
      db: {
        insert: jest.fn(async (_table: string, value: any) => {
          inserted.push(value);
          return `event-${inserted.length}`;
        }),
        get: jest.fn(async (id: string) => ({ _id: id, ...inserted[Number(id.replace("event-", "")) - 1] })),
      },
    };

    const result = await createDraftSuggestionsHandler(ctx as any, {
      familyId: "family-1" as any,
      requestedTitle: "Zoo",
      resourceId: "car-1" as any,
      schedulingBatchId: "scheduling-batch",
      slots: [
        { startDate: "2026-06-10T08:00:00.000Z", endDate: "2026-06-10T09:00:00.000Z" },
        { startDate: "2026-06-11T08:00:00.000Z", endDate: "2026-06-11T09:00:00.000Z" },
        { startDate: "2026-06-12T08:00:00.000Z", endDate: "2026-06-12T09:00:00.000Z" },
      ],
    });

    expect(result.schedulingBatchId).toBe("scheduling-batch");
    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toEqual(expect.objectContaining({ creatorId: "scheduling-agent", clientId: "scheduling-batch-1", title: "[Vorschlag] Zoo", status: "draft", resourceId: "car-1" }));
  });

  test("rejects any LLM result that does not contain exactly 3 slots", async () => {
    const ctx = { db: { insert: jest.fn(), get: jest.fn() } };
    await expect(
      createDraftSuggestionsHandler(ctx as any, {
        familyId: "family-1" as any,
        requestedTitle: "Zoo",
        slots: [{ startDate: "2026-06-10T08:00:00.000Z", endDate: "2026-06-10T09:00:00.000Z" }],
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("scheduling agent authorization and response validation", () => {
  test("allows parent roles to run the scheduling agent", () => {
    expect(() => assertCanRunSchedulingAgent({ familyId: "family-1", role: "ROLE-001" }, "family-1")).not.toThrow();
    expect(() => assertCanRunSchedulingAgent({ familyId: "family-1", role: "ROLE-002" }, "family-1")).not.toThrow();
  });

  test("rejects non-parent roles and foreign-family users", () => {
    expect(() => assertCanRunSchedulingAgent({ familyId: "family-1", role: "ROLE-004" }, "family-1")).toThrow(ConvexError);
    expect(() => assertCanRunSchedulingAgent({ familyId: "family-2", role: "ROLE-001" }, "family-1")).toThrow(ConvexError);
  });

  test("validates JSON slot format, range, and duration", () => {
    expect(
      validateSchedulingSlots(
        JSON.stringify({ slots: [{ startDate: "2026-06-10T08:00:00.000Z", endDate: "2026-06-10T09:00:00.000Z" }, { startDate: "2026-06-10T10:00:00.000Z", endDate: "2026-06-10T11:00:00.000Z" }, { startDate: "2026-06-10T12:00:00.000Z", endDate: "2026-06-10T13:00:00.000Z" }] }),
        { start: "2026-06-10T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z" },
        60,
      ),
    ).toHaveLength(3);
  });
});
