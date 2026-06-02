import { syncPendingCalendarEvents } from "./calendarSync";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createEvent(overrides: Record<string, unknown> = {}) {
  const event = {
    id: "local_evt_1",
    serverId: undefined,
    familyId: "fam_1",
    creatorId: "user_1",
    title: "Termin",
    description: undefined,
    startDate: "2026-06-02T10:00:00.000Z",
    endDate: "2026-06-02T11:00:00.000Z",
    allDay: false,
    rrule: undefined,
    timezoneId: "Europe/Berlin",
    floatingTime: false,
    vetoStatus: undefined,
    vetoReason: undefined,
    vetoChildId: undefined,
    status: "confirmed",
    resourceId: undefined,
    _raw: { _status: "created", _changed: "" },
    update: async (updater: (event: any) => void) => updater(event),
    ...overrides,
  } as any;
  return event;
}

function createDb(events: any[], virtualMembers: Record<string, any> = {}) {
  return {
    collections: {
      get: (table: string) =>
        table === "virtual_members"
          ? {
              find: async (id: string) => {
                if (!virtualMembers[id]) throw new Error("not found");
                return virtualMembers[id];
              },
              query: () => ({ fetch: async () => [] }),
            }
          : {
              query: () => ({
                fetch: async () =>
                  events.filter((event) => !event.serverId || event._raw?._status === "updated"),
              }),
            },
    },
    write: async (writer: () => Promise<void>) => writer(),
  } as any;
}

test("successful sync writes server_id without replacing local id", async () => {
  const event = createEvent();
  const convexClient = {
    mutationCalls: 0,
    mutation: async (_mutationRef: unknown, payload: any) => {
      convexClient.mutationCalls += 1;
      assert(payload.clientId === "local_evt_1", "payload should include idempotency clientId");
      return {
        serverId: "server_evt_1",
        serverRecord: { ...payload, serverId: "server_evt_1", title: "Termin vom Server" },
        mergedFields: { title: "server" },
      };
    },
  };

  const success = await syncPendingCalendarEvents({ db: createDb([event]), convexClient });
  assert(success.synced.length === 1, "one event should sync");
  assert(event.serverId === "server_evt_1", "server_id should be written locally");
  assert(event.id === "local_evt_1", "local WatermelonDB id should not be replaced");
  assert(event.title === "Termin", "new local content should win over server echo during first sync");
});

test("already synced events are skipped", async () => {
  const alreadySynced = createEvent({ serverId: "server_evt_existing", _raw: { _status: "synced", _changed: "" } });
  const convexClient = { mutation: jest.fn() };
  const noOp = await syncPendingCalendarEvents({ db: createDb([alreadySynced]), convexClient: convexClient as any });
  assert(noOp.synced.length === 0, "already synced event should not be pushed");
  expect(convexClient.mutation).not.toHaveBeenCalled();
});

test("sync errors leave event pending", async () => {
  const failingEvent = createEvent({ id: "local_evt_2", resourceId: "local_resource_1" });
  const failingConvexClient = { mutation: async () => { throw new Error("offline"); } };
  const failure = await syncPendingCalendarEvents({ db: createDb([failingEvent]), convexClient: failingConvexClient as any });
  assert(failure.errors.length === 1, "sync errors should be returned");
  assert(!failingEvent.serverId, "failed event should remain pending");
  assert(failingEvent.resourceId === "local_resource_1", "failed sync should not clear local resource id");
});

test("updated synced events are uploaded with resource server ids", async () => {
  const updated = createEvent({
    serverId: "server_evt_existing",
    description: "Old description",
    resourceId: "local_resource_1",
    _raw: { _status: "updated", _changed: "resource_id" },
  });
  const convexClient = {
    mutation: async (_mutationRef: unknown, payload: any) => {
      assert(payload.serverId === "server_evt_existing", "updated event should send server id");
      assert(payload.resourceId === "server_resource_1", "resource id should resolve to the Convex virtual member id");
      return {
        serverId: "server_evt_existing",
        serverRecord: { ...payload, description: "Server description", resourceId: "server_resource_1" },
      };
    },
  };

  const result = await syncPendingCalendarEvents({
    db: createDb([updated], { local_resource_1: { id: "local_resource_1", serverId: "server_resource_1" } }),
    convexClient,
  });

  assert(result.synced.length === 1, "updated event should sync");
  assert(updated.resourceId === "server_resource_1", "merged resource id should be written to the local model");
  assert(updated.description === "Server description", "server-winning unchanged fields should be written to the local model");
});
