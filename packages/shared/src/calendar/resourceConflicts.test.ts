import { strict as assert } from "node:assert";

import {
  findResourceConflict,
  hasIntervalOverlap,
  type ResourceConflictEvent,
} from "./resourceConflicts";

const event = (overrides: Partial<ResourceConflictEvent> = {}): ResourceConflictEvent => ({
  id: "event-1",
  clientId: "client-1",
  startDate: "2026-06-02T10:00:00.000Z",
  endDate: "2026-06-02T11:00:00.000Z",
  timezoneId: "Europe/Berlin",
  floatingTime: false,
  ...overrides,
});

assert.equal(
  hasIntervalOverlap(
    { startDate: "2026-06-02T10:00:00.000Z", endDate: "2026-06-02T11:00:00.000Z" },
    { startDate: "2026-06-02T10:30:00.000Z", endDate: "2026-06-02T11:30:00.000Z" },
  ),
  true,
  "overlapping intervals should conflict",
);

assert.equal(
  hasIntervalOverlap(
    { startDate: "2026-06-02T10:00:00.000Z", endDate: "2026-06-02T11:00:00.000Z" },
    { startDate: "2026-06-02T11:00:00.000Z", endDate: "2026-06-02T12:00:00.000Z" },
  ),
  false,
  "directly adjacent intervals should not conflict",
);

{
  const result = findResourceConflict({
    candidate: event({ id: "candidate", clientId: "candidate-client" }),
    existingEvents: [event({ id: "existing", clientId: "existing-client", startDate: "2026-06-02T10:30:00.000Z", endDate: "2026-06-02T11:30:00.000Z" })],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict?.event.id, "existing");
}

{
  const result = findResourceConflict({
    candidate: event({ id: "candidate", clientId: "candidate-client" }),
    existingEvents: [event({ id: "existing", clientId: "existing-client", startDate: "2026-06-02T11:00:00.000Z", endDate: "2026-06-02T12:00:00.000Z" })],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict, undefined);
}

{
  const result = findResourceConflict({
    candidate: event({ id: "server-1", clientId: "client-1" }),
    existingEvents: [event({ id: "server-1", clientId: "client-1", startDate: "2026-06-02T10:30:00.000Z", endDate: "2026-06-02T11:30:00.000Z" })],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict, undefined, "self update should not conflict with itself");
}

{
  const result = findResourceConflict({
    candidate: event({ id: "server-1", clientId: "client-collision" }),
    existingEvents: [event({ id: "server-2", clientId: "client-collision", startDate: "2026-06-02T10:30:00.000Z", endDate: "2026-06-02T11:30:00.000Z" })],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict?.event.id, "server-2", "server ids must win over accidental clientId collisions");
}

{
  const result = findResourceConflict({
    candidate: event({ id: "candidate", clientId: "candidate-client", startDate: "2026-07-14T10:30:00.000Z", endDate: "2026-07-14T11:30:00.000Z" }),
    existingEvents: [
      event({
        id: "weekly-resource-booking",
        clientId: "weekly-client",
        startDate: "2026-06-02T10:00:00.000Z",
        endDate: "2026-06-02T11:00:00.000Z",
        rrule: "FREQ=WEEKLY",
      }),
    ],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict?.event.id, "weekly-resource-booking", "recurring existing events should be expanded via recurrence helper");
}

{
  const result = findResourceConflict({
    candidate: event({ id: "candidate", clientId: "candidate-client", rrule: "FREQ=WEEKLY;COUNT=4" }),
    existingEvents: [event({ id: "existing", clientId: "existing-client", startDate: "2026-06-16T10:30:00.000Z", endDate: "2026-06-16T11:30:00.000Z" })],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.conflict?.event.id, "existing", "recurring candidate events should be expanded via recurrence helper");
}

{
  const result = findResourceConflict({
    candidate: event({ id: "candidate", clientId: "candidate-client", rrule: "FREQ=NOTREAL" }),
    existingEvents: [],
  });

  assert.equal(result.conflict, undefined);
  assert.equal(result.error?.code, "INVALID_RRULE");
  assert.equal(result.error?.message, "Die Wiederholungsregel ist ungültig. Bitte prüfe Rhythmus und Enddatum.");
}
