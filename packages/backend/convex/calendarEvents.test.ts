import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import { clearVetoHandler, deleteEventHandler, proposeEventForCaregiverHandler, raiseVetoHandler, sanitizeCaregiverEvent, validateDraftConfirmationReview } from "./calendarEvents";

describe("sanitizeCaregiverEvent", () => {
  test("keeps public event details visible", () => {
    const event = {
      title: "Familienessen",
      description: "Bei Oma",
      floatingTime: false,
    };

    expect(sanitizeCaregiverEvent(event)).toEqual(event);
  });

  test("redacts private event details for caregiver access", () => {
    expect(
      sanitizeCaregiverEvent({
        title: "Arzttermin",
        description: "Diagnose",
        floatingTime: true,
        rrule: "FREQ=WEEKLY",
        vetoReason: "Privat",
      }),
    ).toEqual({
      title: "Privater Termin",
      description: undefined,
      floatingTime: true,
      rrule: undefined,
      vetoReason: undefined,
    });
  });
});

describe("proposeEventForCaregiverHandler", () => {
  const originalSecret = process.env.CAREGIVER_API_SECRET;

  afterEach(() => {
    process.env.CAREGIVER_API_SECRET = originalSecret;
  });

  test("creates a draft event when caregiver secret is valid", async () => {
    process.env.CAREGIVER_API_SECRET = "valid-secret";
    const insert = jest.fn().mockResolvedValue("event-1");
    const get = jest.fn().mockResolvedValue({
      _id: "event-1",
      status: "draft",
      creatorId: "caregiver",
      clientId: "caregiver-proposal-1",
    });
    const ctx = { db: { insert, get } };

    const result = await proposeEventForCaregiverHandler(ctx as any, {
      familyId: "family-1" as any,
      title: "Schwimmkurs",
      description: "Bitte übernehmen",
      startDate: "2026-06-05T08:00:00.000Z",
      endDate: "2026-06-05T09:00:00.000Z",
      allDay: false,
      secret: "valid-secret",
    });

    expect(insert).toHaveBeenCalledWith(
      "calendarEvents",
      expect.objectContaining({
        familyId: "family-1",
        title: "Schwimmkurs",
        description: "Bitte übernehmen",
        startDate: "2026-06-05T08:00:00.000Z",
        endDate: "2026-06-05T09:00:00.000Z",
        allDay: false,
        status: "draft",
        creatorId: "caregiver",
        floatingTime: false,
      }),
    );
    expect(insert.mock.calls[0][1].clientId).toMatch(/^caregiver-/);
    expect(result).toEqual({
      serverId: "event-1",
      serverRecord: {
        _id: "event-1",
        status: "draft",
        creatorId: "caregiver",
        clientId: "caregiver-proposal-1",
      },
    });
  });

  test("rejects draft event creation when caregiver secret is invalid", async () => {
    process.env.CAREGIVER_API_SECRET = "valid-secret";
    const ctx = { db: { insert: jest.fn(), get: jest.fn() } };

    await expect(
      proposeEventForCaregiverHandler(ctx as any, {
        familyId: "family-1" as any,
        title: "Schwimmkurs",
        startDate: "2026-06-05T08:00:00.000Z",
        endDate: "2026-06-05T09:00:00.000Z",
        allDay: false,
        secret: "wrong-secret",
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});

describe("draft event review permissions", () => {
  test("allows a parent to confirm a draft event", () => {
    expect(validateDraftConfirmationReview({ role: "ROLE-002" }, "draft", "confirmed")).toBe(true);
  });

  test("rejects a child trying to confirm a draft event", () => {
    expect(() => validateDraftConfirmationReview({ role: "ROLE-004" }, "draft", "confirmed")).toThrow(ConvexError);
  });
});

function createVetoCtx(user: any, event: any) {
  return {
    auth: { getUserIdentity: jest.fn().mockResolvedValue({ subject: user.clerkId }) },
    db: {
      get: jest.fn().mockResolvedValue(event),
      patch: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue("activity-1"),
      query: jest.fn(() => ({
        withIndex: jest.fn(() => ({
          first: jest.fn().mockResolvedValue(user),
        })),
      })),
    },
  };
}

describe("veto handlers", () => {
  test("allows a child to raise a veto with a reason", async () => {
    const ctx = createVetoCtx(
      { clerkId: "child-clerk", familyId: "family-1", role: "ROLE-004", name: "Mia" },
      { _id: "event-1", familyId: "family-1" },
    );

    await expect(raiseVetoHandler(ctx as any, { eventId: "event-1", reason: "Ich habe Training" })).resolves.toEqual({ eventId: "event-1", vetoStatus: "vetoed" });
    expect(ctx.db.patch).toHaveBeenCalledWith("event-1", expect.objectContaining({ vetoStatus: "vetoed", vetoReason: "Ich habe Training", vetoChildId: "child-clerk" }));
    expect(ctx.db.insert).toHaveBeenCalledWith("activityFeedEntries", expect.objectContaining({ type: "event_comment", summary: "Einspruch von Mia erhoben" }));
  });

  test("rejects a parent or member from another family raising a veto", async () => {
    const parentCtx = createVetoCtx(
      { clerkId: "parent-clerk", familyId: "family-1", role: "ROLE-002" },
      { _id: "event-1", familyId: "family-1" },
    );
    await expect(raiseVetoHandler(parentCtx as any, { eventId: "event-1", reason: "Nein" })).rejects.toBeInstanceOf(ConvexError);

    const foreignCtx = createVetoCtx(
      { clerkId: "child-2", familyId: "family-2", role: "ROLE-004" },
      { _id: "event-1", familyId: "family-1" },
    );
    await expect(raiseVetoHandler(foreignCtx as any, { eventId: "event-1", reason: "Konflikt" })).rejects.toBeInstanceOf(ConvexError);
  });

  test("allows parents to clear a veto but rejects children", async () => {
    const parentCtx = createVetoCtx(
      { clerkId: "parent-clerk", familyId: "family-1", role: "ROLE-002" },
      { _id: "event-1", familyId: "family-1", vetoStatus: "vetoed" },
    );
    await expect(clearVetoHandler(parentCtx as any, { eventId: "event-1" })).resolves.toEqual({ cleared: true, eventId: "event-1" });
    expect(parentCtx.db.patch).toHaveBeenCalledWith("event-1", expect.objectContaining({ vetoStatus: undefined, vetoReason: undefined, vetoChildId: undefined }));

    const childCtx = createVetoCtx(
      { clerkId: "child-clerk", familyId: "family-1", role: "ROLE-004" },
      { _id: "event-1", familyId: "family-1", vetoStatus: "vetoed" },
    );
    await expect(clearVetoHandler(childCtx as any, { eventId: "event-1" })).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("deleteEventHandler", () => {
  test("deletes a draft event for a family owner and records activity", async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    const insertActivity = jest.fn().mockResolvedValue("activity-1");
    const ctx = {
      auth: { getUserIdentity: jest.fn().mockResolvedValue({ subject: "owner-clerk" }) },
      db: {
        get: jest.fn().mockResolvedValue({ _id: "event-1", familyId: "family-1", status: "draft" }),
        delete: deleteFn,
        insert: insertActivity,
        query: jest.fn((table: string) => ({
          withIndex: jest.fn(() => ({
            first: jest.fn().mockResolvedValue(table === "users" ? { clerkId: "owner-clerk", familyId: "family-1", role: "ROLE-001" } : null),
          })),
        })),
      },
    };

    await expect(deleteEventHandler(ctx as any, { eventId: "event-1" as any, familyId: "family-1" as any })).resolves.toEqual({ deleted: true, eventId: "event-1" });
    expect(deleteFn).toHaveBeenCalledWith("event-1");
    expect(insertActivity).toHaveBeenCalledWith(
      "activityFeedEntries",
      expect.objectContaining({ familyId: "family-1", summary: "Terminvorschlag abgelehnt" }),
    );
  });
});
