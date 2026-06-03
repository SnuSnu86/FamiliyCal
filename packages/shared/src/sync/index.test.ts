import {
  buildAlbumSyncPayload,
  buildCalendarEventSyncPayload,
  buildListSyncPayload,
  buildMemoSyncPayload,
  mergeAlbumFields,
  mergeCalendarEventFields,
  mergeListFields,
  mergeMemoFields,
  toCamelCase,
  toSnakeCase,
} from "./index";

const isoDate = "2026-06-02T10:20:30.000Z";
const snakePayload = {
  family_id: "fam_1",
  calendar_events: [
    {
      server_id: "evt_1",
      start_date: isoDate,
      nested_value: { veto_child_id: "child_1" },
    },
  ],
  "already-odd key": "kept",
};

const camelPayload = {
  familyId: "fam_1",
  calendarEvents: [
    {
      serverId: "evt_1",
      startDate: isoDate,
      nestedValue: { vetoChildId: "child_1" },
    },
  ],
};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const camel = toCamelCase(snakePayload) as any;
assert(camel.familyId === "fam_1", "family_id should map to familyId");
assert(camel.calendarEvents[0]?.startDate === isoDate, "ISO strings should stay unchanged");
assert(camel.calendarEvents[0]?.nestedValue.vetoChildId === "child_1", "nested object keys should map");
assert(camel["already-odd key"] === "kept", "odd keys should not crash mapping");

const snake = toSnakeCase(camelPayload) as unknown as typeof snakePayload;
assert(snake.family_id === "fam_1", "familyId should map to family_id");
assert(snake.calendar_events[0]?.server_id === "evt_1", "array item keys should map");
assert(snake.calendar_events[0]?.nested_value.veto_child_id === "child_1", "nested camel keys should map");

const localEvent = {
  id: "local_evt_1",
  server_id: undefined,
  family_id: "fam_1",
  creator_id: "user_1",
  title: "Local title",
  description: "Local description",
  start_date: isoDate,
  end_date: "2026-06-02T11:20:30.000Z",
  all_day: false,
  rrule: "FREQ=WEEKLY;COUNT=4",
  timezone_id: "Europe/Berlin",
  floating_time: true,
  veto_status: "none",
  veto_reason: undefined,
  veto_child_id: undefined,
  status: "confirmed",
  resource_id: "resource_1",
};

const syncPayload = buildCalendarEventSyncPayload(localEvent);
assert(syncPayload.clientId === "local_evt_1", "clientId should be WatermelonDB record id");
assert(syncPayload.familyId === "fam_1", "familyId should be mapped from family_id");
assert(syncPayload.startDate === isoDate, "startDate should be camelCase mapped");
assert(syncPayload.allDay === false, "allDay false should be preserved in sync payload");
assert(syncPayload.rrule === "FREQ=WEEKLY;COUNT=4", "rrule should be preserved in sync payload");
assert(syncPayload.timezoneId === "Europe/Berlin", "timezoneId should be camelCase mapped and preserved");
assert(syncPayload.floatingTime === true, "floatingTime should be camelCase mapped and preserved");
assert(syncPayload.resourceId === "resource_1", "resourceId should be camelCase mapped and preserved");
assert(syncPayload.locallyChangedFields.includes("title"), "payload should include changed fields");

const merge = mergeCalendarEventFields(
  {
    title: "Local changed title",
    description: "Old local description",
    timezoneId: "Europe/Berlin",
    rrule: "FREQ=WEEKLY;COUNT=4",
    floatingTime: true,
    resourceId: "local_resource",
    serverId: undefined,
  },
  {
    title: "Server title",
    description: "Server description",
    timezoneId: "Europe/Oslo",
    rrule: "FREQ=DAILY;COUNT=2",
    floatingTime: false,
    resourceId: "server_resource",
    serverId: "server_evt_1",
    updatedAt: 123,
  },
  ["title", "rrule", "floatingTime", "resourceId"],
);

assert(merge.record.title === "Local changed title", "locally changed title should win");
assert(merge.record.description === "Server description", "unchanged local description should take server value");
assert(merge.record.timezoneId === "Europe/Oslo", "unchanged local timezone should take server value");
assert(merge.record.rrule === "FREQ=WEEKLY;COUNT=4", "locally changed rrule should win");
assert(merge.record.floatingTime === true, "locally changed floatingTime should win");
assert(merge.record.resourceId === "local_resource", "locally changed resourceId should win and remain content data");
assert(merge.record.serverId === "server_evt_1", "server sync metadata should win");
assert(merge.mergedFields.title === "local", "title merge source should be local");
assert(merge.mergedFields.description === "server", "description merge source should be server");

// AC4: dirty-field tracking — only WatermelonDB-changed columns count as local.
const updatedEvent = {
  id: "local_evt_2",
  family_id: "fam_1",
  server_id: "server_evt_2",
  creator_id: "user_2",
  title: "Edited title",
  description: "Edited description",
  start_date: isoDate,
  _raw: { _status: "updated", _changed: "title,server_id" },
} as Record<string, unknown> & { id: string };
const updatedPayload = buildCalendarEventSyncPayload(updatedEvent);
assert(
  updatedPayload.locallyChangedFields.length === 1 && updatedPayload.locallyChangedFields[0] === "title",
  "only WatermelonDB-changed content columns should be marked locally changed (sync metadata filtered)",
);
assert(
  updatedPayload.serverId === "server_evt_2",
  "synced updates should forward the real server id to the mutation",
);
assert(
  !("creatorId" in updatedPayload),
  "payload must never include creatorId (assigned server-side)",
);

const pendingEvent = {
  id: "local_evt_pending",
  family_id: "fam_1",
  server_id: null,
  title: "Pending title",
  start_date: isoDate,
} as Record<string, unknown> & { id: string };
const pendingPayload = buildCalendarEventSyncPayload(pendingEvent);
assert(!("serverId" in pendingPayload), "pending event must not forward a null server id to the mutation");

const clearedPayload = buildCalendarEventSyncPayload({
  id: "local_evt_clear",
  family_id: "fam_1",
  title: "Clear recurrence",
  start_date: isoDate,
  rrule: null,
  timezone_id: null,
  resource_id: null,
} as Record<string, unknown> & { id: string });
assert("rrule" in clearedPayload && clearedPayload.rrule === undefined, "cleared rrule should be Convex-optional undefined");
assert("timezoneId" in clearedPayload && clearedPayload.timezoneId === undefined, "cleared timezone should be Convex-optional undefined");
assert("resourceId" in clearedPayload && clearedPayload.resourceId === undefined, "cleared resourceId should be Convex-optional undefined");

const clearedRecurrence = mergeCalendarEventFields(
  { rrule: null, timezoneId: null, floatingTime: false },
  { rrule: "FREQ=DAILY", timezoneId: "Europe/Berlin", floatingTime: true },
  ["rrule", "timezoneId", "floatingTime"],
);
assert(clearedRecurrence.record.rrule === null, "locally cleared recurrence should stay cleared");
assert(clearedRecurrence.record.timezoneId === null, "locally cleared timezone should stay cleared");
assert(clearedRecurrence.record.floatingTime === false, "locally changed false floatingTime should stay false");

// AC4: a synced record reports no local changes, so the server wins on merge.
const syncedEvent = {
  id: "local_evt_3",
  family_id: "fam_1",
  title: "Synced title",
  _raw: { _status: "synced", _changed: "" },
} as Record<string, unknown> & { id: string };
const syncedPayload = buildCalendarEventSyncPayload(syncedEvent);
assert(syncedPayload.locallyChangedFields.length === 0, "synced record should report no locally changed fields");

const serverWinsMerge = mergeCalendarEventFields(
  { title: "Stale local title", description: "Stale local description" },
  { title: "Fresh server title", description: "Fresh server description" },
  syncedPayload.locallyChangedFields,
);
assert(serverWinsMerge.record.title === "Fresh server title", "with no local changes the server title must win");
assert(serverWinsMerge.record.description === "Fresh server description", "with no local changes the server description must win");

// --- Memos / Lists / Albums ---
const localMemo = {
  id: "local_memo_1",
  family_id: "fam_1",
  server_id: null,
  creator_id: "user_1",
  title: "Memo title",
  content: "Memo content",
  _raw: { _status: "created", _changed: "" },
} as Record<string, unknown> & { id: string };

const memoPayload = buildMemoSyncPayload(localMemo);
assert(memoPayload.clientId === "local_memo_1", "memo clientId should be WatermelonDB record id");
assert(memoPayload.familyId === "fam_1", "memo familyId should be mapped from family_id");
assert(memoPayload.title === "Memo title", "memo title should be in payload");
assert(!("creatorId" in memoPayload), "memo payload must never include creatorId (assigned server-side)");

const memoMerge = mergeMemoFields(
  { title: "Local memo title", content: "Local memo content" },
  { title: "Server memo title", content: "Server memo content", serverId: "memo_srv_1", updatedAt: 1 },
  ["content"],
);
assert(memoMerge.record.title === "Server memo title", "unchanged memo title should take server value");
assert(memoMerge.record.content === "Local memo content", "locally changed memo content should win");

const localList = {
  id: "local_list_1",
  family_id: "fam_1",
  server_id: null,
  title: "Einkauf",
  items: JSON.stringify([{ text: "Milch", completed: false }]),
  _raw: { _status: "updated", _changed: "items" },
} as Record<string, unknown> & { id: string };

const listPayload = buildListSyncPayload(localList as any);
assert(listPayload.clientId === "local_list_1", "list clientId should be WatermelonDB record id");
assert(Array.isArray(listPayload.items), "list items should be parsed into an array for payload");
assert(listPayload.items?.[0]?.text === "Milch", "list item text should survive JSON parse");

const listMerge = mergeListFields(
  { title: "Local list", items: [{ text: "Local", completed: true }] },
  { title: "Server list", items: [{ text: "Server", completed: false }], serverId: "list_srv_1" },
  ["title"],
);
assert(listMerge.record.title === "Local list", "locally changed list title should win");
assert(Array.isArray(listMerge.record.items), "merged list items should be an array");

const localAlbum = {
  id: "local_album_1",
  family_id: "fam_1",
  server_id: null,
  name: "Album",
  photos: JSON.stringify([{ storageId: "s1", fileSize: 123, uploadedAt: 1 }]),
  _raw: { _status: "updated", _changed: "photos" },
} as Record<string, unknown> & { id: string };

const albumPayload = buildAlbumSyncPayload(localAlbum as any);
assert(albumPayload.clientId === "local_album_1", "album clientId should be WatermelonDB record id");
assert(Array.isArray(albumPayload.photos), "album photos should be parsed into an array for payload");
assert((albumPayload.photos?.[0] as any)?.storageId === "s1", "album storageId should survive JSON parse");

const albumMerge = mergeAlbumFields(
  { name: "Local album", photos: [{ storageId: "l1", fileSize: 1, uploadedAt: 1 }] },
  { name: "Server album", photos: [{ storageId: "s1", fileSize: 2, uploadedAt: 2 }], serverId: "alb_srv_1" },
  [],
);
assert(albumMerge.record.name === "Server album", "with no local changes server album name must win");
assert(Array.isArray(albumMerge.record.photos), "merged album photos should be an array");
