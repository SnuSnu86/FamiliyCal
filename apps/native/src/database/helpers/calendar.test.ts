import { addHoursAsIsoUtc, createLocalEvent } from "./calendar";

test("calendar helper utilities and event creation", async () => {
  if (addHoursAsIsoUtc("2026-06-02T10:00:00.000Z", 1) !== "2026-06-02T11:00:00.000Z") {
    throw new Error("addHoursAsIsoUtc muss eine Stunde in UTC addieren");
  }

  let writeCalled = false;
  const created: Record<string, unknown> = {};
  const mockDb = {
    collections: {
      get: () => ({
        create: async (writer: (event: Record<string, unknown>) => void) => {
          writer(created);
          return created;
        },
      }),
    },
    write: async (callback: () => Promise<unknown>) => {
      writeCalled = true;
      return callback();
    },
  };

  await createLocalEvent(mockDb as never, {
    family_id: "family-1",
    title: "Offline Termin",
    start_date: "2026-06-02T10:00:00.000Z",
  });

  if (!writeCalled) throw new Error("database.write muss aufgerufen werden");
  if (created.serverId !== null) throw new Error("server_id muss lokal null sein");
  if (created.endDate !== "2026-06-02T11:00:00.000Z") throw new Error("Default-Enddatum falsch");
  if (created.allDay !== false) throw new Error("all_day Default falsch");
  if (created.floatingTime !== false) throw new Error("floating_time Default falsch");
  if (created.status !== "confirmed") throw new Error("status Default falsch");
});
