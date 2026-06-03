const SNAKE_SEGMENT_REGEX = /_([a-zA-Z0-9])/g;
const CAMEL_SEGMENT_REGEX = /([a-z0-9])([A-Z])/g;

export type CalendarEventField =
  | "serverId"
  | "familyId"
  | "creatorId"
  | "clientId"
  | "title"
  | "description"
  | "startDate"
  | "endDate"
  | "allDay"
  | "rrule"
  | "timezoneId"
  | "floatingTime"
  | "vetoStatus"
  | "vetoReason"
  | "vetoChildId"
  | "status"
  | "resourceId"
  | "updatedAt"
  | "createdAt";

export type CalendarEventLike = {
  id: string;
  serverId?: string | null;
  server_id?: string | null;
  locallyChangedFields?: CalendarEventField[];
  [key: string]: unknown;
};

export type LocalCalendarEventPayload = Partial<Record<CalendarEventField, unknown>> & {
  clientId: string;
  locallyChangedFields: CalendarEventField[];
};

export type ServerCalendarEventPayload = Partial<Record<CalendarEventField, unknown>> & {
  serverId: string;
  clientId: string;
};

export type FieldMergeResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  record: T;
  mergedFields: Record<string, "local" | "server">;
};

export type SyncCalendarEventResult = {
  serverId: string;
  serverRecord: ServerCalendarEventPayload;
  mergedFields: Record<string, "local" | "server">;
};

export type MemoField =
  | "serverId"
  | "familyId"
  | "creatorId"
  | "clientId"
  | "title"
  | "content"
  | "updatedAt"
  | "createdAt";

export type MemoLike = {
  id: string;
  serverId?: string | null;
  server_id?: string | null;
  locallyChangedFields?: MemoField[];
  [key: string]: unknown;
};

export type LocalMemoPayload = Partial<Record<MemoField, unknown>> & {
  clientId: string;
  locallyChangedFields: MemoField[];
};

export type ServerMemoPayload = Partial<Record<MemoField, unknown>> & {
  serverId: string;
  clientId: string;
};

export type SyncMemoResult = {
  serverId: string;
  serverRecord: ServerMemoPayload;
  mergedFields: Record<string, "local" | "server">;
};

export type ListItem = { text: string; completed: boolean };

export type ListField =
  | "serverId"
  | "familyId"
  | "creatorId"
  | "clientId"
  | "title"
  | "items"
  | "updatedAt"
  | "createdAt";

export type ListLike = {
  id: string;
  serverId?: string | null;
  server_id?: string | null;
  locallyChangedFields?: ListField[];
  items?: unknown;
  [key: string]: unknown;
};

export type LocalListPayload = Partial<Record<ListField, unknown>> & {
  clientId: string;
  locallyChangedFields: ListField[];
  items?: ListItem[];
};

export type ServerListPayload = Partial<Record<ListField, unknown>> & {
  serverId: string;
  clientId: string;
  items?: ListItem[];
};

export type SyncListResult = {
  serverId: string;
  serverRecord: ServerListPayload;
  mergedFields: Record<string, "local" | "server">;
};

export type AlbumPhoto = { storageId: string; fileSize: number; uploadedAt: number };

export type AlbumField =
  | "serverId"
  | "familyId"
  | "creatorId"
  | "clientId"
  | "name"
  | "photos"
  | "updatedAt"
  | "createdAt";

export type AlbumLike = {
  id: string;
  serverId?: string | null;
  server_id?: string | null;
  locallyChangedFields?: AlbumField[];
  photos?: unknown;
  [key: string]: unknown;
};

export type LocalAlbumPayload = Partial<Record<AlbumField, unknown>> & {
  clientId: string;
  locallyChangedFields: AlbumField[];
  photos?: AlbumPhoto[];
};

export type ServerAlbumPayload = Partial<Record<AlbumField, unknown>> & {
  serverId: string;
  clientId: string;
  photos?: AlbumPhoto[];
};

export type SyncAlbumResult = {
  serverId: string;
  serverRecord: ServerAlbumPayload;
  mergedFields: Record<string, "local" | "server">;
};

// User-editable content fields that may diverge from the server state.
// serverId/familyId/creatorId/clientId/createdAt/updatedAt are sync- or
// server-owned metadata and are never treated as locally-changed content.
const CONTENT_FIELDS: CalendarEventField[] = [
  "title",
  "description",
  "startDate",
  "endDate",
  "allDay",
  "rrule",
  "timezoneId",
  "floatingTime",
  "vetoStatus",
  "vetoReason",
  "vetoChildId",
  "status",
  "resourceId",
];

// Exact set of fields forwarded to the `syncCalendarEvent` mutation. familyId is
// required; serverId/clientId/locallyChangedFields are added separately.
// creatorId is intentionally omitted — it is assigned server-side from the
// authenticated user and must never be supplied by the client.
const PAYLOAD_FIELDS: CalendarEventField[] = ["familyId", ...CONTENT_FIELDS];

const SYNC_METADATA_FIELDS = new Set(["serverId", "clientId", "createdAt", "updatedAt"]);

type WatermelonRawMeta = { _status?: string; _changed?: string };

// Derive which fields were changed locally so the merge keeps local edits only
// for those fields and adopts the server value for everything else (AC4).
// Prefers WatermelonDB's column-level change tracking (`_raw._status`/`_changed`)
// over a blanket "everything changed" assumption.
function deriveLocallyChangedFields(event: CalendarEventLike): CalendarEventField[] {
  if (event.locallyChangedFields) return event.locallyChangedFields;

  const raw = (event as { _raw?: WatermelonRawMeta })._raw;
  if (raw && typeof raw._status === "string") {
    // No local changes since the last server state: server is authoritative.
    if (raw._status === "synced") return [];
    // Existing record with tracked column-level changes: only those win locally.
    if (raw._status === "updated") {
      const contentFields = new Set<string>(CONTENT_FIELDS);
      return (raw._changed ?? "")
        .split(",")
        .map((column) => snakeKeyToCamel(column.trim()))
        .filter((field): field is CalendarEventField => contentFields.has(field));
    }
    // "created" (brand-new local record) falls through: all content is local.
  }

  // Fallback when WatermelonDB change metadata is unavailable (e.g. plain
  // objects in tests): treat all content fields as locally changed.
  return [...CONTENT_FIELDS];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function snakeKeyToCamel(key: string): string {
  return key.replace(SNAKE_SEGMENT_REGEX, (_, char: string) => char.toUpperCase());
}

function camelKeyToSnake(key: string): string {
  return key.replace(CAMEL_SEGMENT_REGEX, "$1_$2").replace(/[-\s]+/g, "_").toLowerCase();
}

function mapKeysDeep(value: unknown, keyMapper: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapKeysDeep(item, keyMapper));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce<Record<string, unknown>>((mapped, [key, entryValue]) => {
    mapped[keyMapper(key)] = mapKeysDeep(entryValue, keyMapper);
    return mapped;
  }, {});
}

export function toCamelCase<T = unknown>(obj: T): T {
  return mapKeysDeep(obj, snakeKeyToCamel) as T;
}

export function toSnakeCase<T = unknown>(obj: T): T {
  return mapKeysDeep(obj, camelKeyToSnake) as T;
}

export function buildCalendarEventSyncPayload(event: CalendarEventLike): LocalCalendarEventPayload {
  const camelEvent = toCamelCase<Record<string, unknown>>(event as Record<string, unknown>);
  const payload: LocalCalendarEventPayload = {
    clientId: event.id,
    locallyChangedFields: deriveLocallyChangedFields(event),
  };

  for (const field of PAYLOAD_FIELDS) {
    if (field in camelEvent) (payload as Record<string, unknown>)[field] = camelEvent[field] === null ? undefined : camelEvent[field];
  }

  // Only forward a real server id. The mutation arg is v.optional(v.id()), which
  // rejects an explicit null/undefined that a still-pending event would carry.
  const serverId = camelEvent.serverId ?? camelEvent.server_id;
  if (typeof serverId === "string" && serverId.length > 0) {
    (payload as Record<string, unknown>).serverId = serverId;
  }

  return payload;
}

export function mergeCalendarEventFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  locallyChangedFields: string[],
): FieldMergeResult {
  const changed = new Set(locallyChangedFields);
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const record: Record<string, unknown> = {};
  const mergedFields: Record<string, "local" | "server"> = {};

  for (const key of keys) {
    if (SYNC_METADATA_FIELDS.has(key) || !changed.has(key)) {
      record[key] = key in server ? server[key] : local[key];
      mergedFields[key] = key in server ? "server" : "local";
    } else {
      record[key] = local[key];
      mergedFields[key] = "local";
    }
  }

  return { record, mergedFields };
}

const MEMO_CONTENT_FIELDS: MemoField[] = ["title", "content"];
const MEMO_PAYLOAD_FIELDS: MemoField[] = ["familyId", ...MEMO_CONTENT_FIELDS];
const MEMO_SYNC_METADATA_FIELDS = new Set(["serverId", "clientId", "createdAt", "updatedAt"]);

function deriveLocallyChangedMemoFields(memo: MemoLike): MemoField[] {
  if (memo.locallyChangedFields) return memo.locallyChangedFields;

  const raw = (memo as { _raw?: WatermelonRawMeta })._raw;
  if (raw && typeof raw._status === "string") {
    if (raw._status === "synced") return [];
    if (raw._status === "updated") {
      const contentFields = new Set<string>(MEMO_CONTENT_FIELDS);
      return (raw._changed ?? "")
        .split(",")
        .map((column) => snakeKeyToCamel(column.trim()))
        .filter((field): field is MemoField => contentFields.has(field));
    }
  }

  return [...MEMO_CONTENT_FIELDS];
}

export function buildMemoSyncPayload(memo: MemoLike): LocalMemoPayload {
  const camelMemo = toCamelCase<Record<string, unknown>>(memo as Record<string, unknown>);
  const payload: LocalMemoPayload = {
    clientId: memo.id,
    locallyChangedFields: deriveLocallyChangedMemoFields(memo),
  };

  for (const field of MEMO_PAYLOAD_FIELDS) {
    if (field in camelMemo) (payload as Record<string, unknown>)[field] = camelMemo[field] === null ? undefined : camelMemo[field];
  }

  const serverId = camelMemo.serverId ?? camelMemo.server_id;
  if (typeof serverId === "string" && serverId.length > 0) {
    (payload as Record<string, unknown>).serverId = serverId;
  }

  return payload;
}

export function mergeMemoFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  locallyChangedFields: string[],
): FieldMergeResult {
  const changed = new Set(locallyChangedFields);
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const record: Record<string, unknown> = {};
  const mergedFields: Record<string, "local" | "server"> = {};

  for (const key of keys) {
    if (MEMO_SYNC_METADATA_FIELDS.has(key) || !changed.has(key)) {
      record[key] = key in server ? server[key] : local[key];
      mergedFields[key] = key in server ? "server" : "local";
    } else {
      record[key] = local[key];
      mergedFields[key] = "local";
    }
  }

  return { record, mergedFields };
}

const LIST_CONTENT_FIELDS: ListField[] = ["title", "items"];
const LIST_PAYLOAD_FIELDS: ListField[] = ["familyId", ...LIST_CONTENT_FIELDS];
const LIST_SYNC_METADATA_FIELDS = new Set(["serverId", "clientId", "createdAt", "updatedAt"]);

function deriveLocallyChangedListFields(list: ListLike): ListField[] {
  if (list.locallyChangedFields) return list.locallyChangedFields;

  const raw = (list as { _raw?: WatermelonRawMeta })._raw;
  if (raw && typeof raw._status === "string") {
    if (raw._status === "synced") return [];
    if (raw._status === "updated") {
      const contentFields = new Set<string>(LIST_CONTENT_FIELDS);
      return (raw._changed ?? "")
        .split(",")
        .map((column) => snakeKeyToCamel(column.trim()))
        .filter((field): field is ListField => contentFields.has(field));
    }
  }

  return [...LIST_CONTENT_FIELDS];
}

function normalizeListItems(items: unknown): ListItem[] | undefined {
  if (items === undefined || items === null) return undefined;
  let array: unknown[] = [];
  if (Array.isArray(items)) {
    array = items;
  } else if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) array = parsed;
    } catch {
      return [];
    }
  } else {
    return undefined;
  }

  return array.filter((item): item is ListItem => {
    return (
      item !== null &&
      typeof item === "object" &&
      "text" in item &&
      typeof (item as any).text === "string" &&
      "completed" in item &&
      typeof (item as any).completed === "boolean"
    );
  });
}

export function buildListSyncPayload(list: ListLike): LocalListPayload {
  const camelList = toCamelCase<Record<string, unknown>>(list as Record<string, unknown>);
  const payload: LocalListPayload = {
    clientId: list.id,
    locallyChangedFields: deriveLocallyChangedListFields(list),
  };

  for (const field of LIST_PAYLOAD_FIELDS) {
    if (field in camelList) (payload as Record<string, unknown>)[field] = camelList[field] === null ? undefined : camelList[field];
  }

  const items = normalizeListItems((camelList as Record<string, unknown>).items);
  if (items) payload.items = items;

  const serverId = camelList.serverId ?? camelList.server_id;
  if (typeof serverId === "string" && serverId.length > 0) {
    (payload as Record<string, unknown>).serverId = serverId;
  }

  return payload;
}

export function mergeListFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  locallyChangedFields: string[],
): FieldMergeResult {
  const changed = new Set(locallyChangedFields);
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const record: Record<string, unknown> = {};
  const mergedFields: Record<string, "local" | "server"> = {};

  for (const key of keys) {
    if (LIST_SYNC_METADATA_FIELDS.has(key) || !changed.has(key)) {
      record[key] = key in server ? server[key] : local[key];
      mergedFields[key] = key in server ? "server" : "local";
    } else {
      record[key] = local[key];
      mergedFields[key] = "local";
    }
  }

  if ("items" in record) {
    record.items = normalizeListItems(record.items) ?? [];
  }

  return { record, mergedFields };
}

const ALBUM_CONTENT_FIELDS: AlbumField[] = ["name", "photos"];
const ALBUM_PAYLOAD_FIELDS: AlbumField[] = ["familyId", ...ALBUM_CONTENT_FIELDS];
const ALBUM_SYNC_METADATA_FIELDS = new Set(["serverId", "clientId", "createdAt", "updatedAt"]);

function deriveLocallyChangedAlbumFields(album: AlbumLike): AlbumField[] {
  if (album.locallyChangedFields) return album.locallyChangedFields;

  const raw = (album as { _raw?: WatermelonRawMeta })._raw;
  if (raw && typeof raw._status === "string") {
    if (raw._status === "synced") return [];
    if (raw._status === "updated") {
      const contentFields = new Set<string>(ALBUM_CONTENT_FIELDS);
      return (raw._changed ?? "")
        .split(",")
        .map((column) => snakeKeyToCamel(column.trim()))
        .filter((field): field is AlbumField => contentFields.has(field));
    }
  }

  return [...ALBUM_CONTENT_FIELDS];
}

function normalizeAlbumPhotos(photos: unknown): AlbumPhoto[] | undefined {
  if (photos === undefined || photos === null) return undefined;
  let array: unknown[] = [];
  if (Array.isArray(photos)) {
    array = photos;
  } else if (typeof photos === "string") {
    try {
      const parsed = JSON.parse(photos);
      if (Array.isArray(parsed)) array = parsed;
    } catch {
      return [];
    }
  } else {
    return undefined;
  }

  return array.filter((photo): photo is AlbumPhoto => {
    return (
      photo !== null &&
      typeof photo === "object" &&
      "storageId" in photo &&
      typeof (photo as any).storageId === "string" &&
      "fileSize" in photo &&
      typeof (photo as any).fileSize === "number" &&
      "uploadedAt" in photo &&
      typeof (photo as any).uploadedAt === "number"
    );
  });
}

export function buildAlbumSyncPayload(album: AlbumLike): LocalAlbumPayload {
  const camelAlbum = toCamelCase<Record<string, unknown>>(album as Record<string, unknown>);
  const payload: LocalAlbumPayload = {
    clientId: album.id,
    locallyChangedFields: deriveLocallyChangedAlbumFields(album),
  };

  for (const field of ALBUM_PAYLOAD_FIELDS) {
    if (field in camelAlbum) (payload as Record<string, unknown>)[field] = camelAlbum[field] === null ? undefined : camelAlbum[field];
  }

  const photos = normalizeAlbumPhotos((camelAlbum as Record<string, unknown>).photos);
  if (photos) payload.photos = photos;

  const serverId = camelAlbum.serverId ?? camelAlbum.server_id;
  if (typeof serverId === "string" && serverId.length > 0) {
    (payload as Record<string, unknown>).serverId = serverId;
  }

  return payload;
}

export function mergeAlbumFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  locallyChangedFields: string[],
): FieldMergeResult {
  const changed = new Set(locallyChangedFields);
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const record: Record<string, unknown> = {};
  const mergedFields: Record<string, "local" | "server"> = {};

  for (const key of keys) {
    if (ALBUM_SYNC_METADATA_FIELDS.has(key) || !changed.has(key)) {
      record[key] = key in server ? server[key] : local[key];
      mergedFields[key] = key in server ? "server" : "local";
    } else {
      record[key] = local[key];
      mergedFields[key] = "local";
    }
  }

  if ("photos" in record) {
    record.photos = normalizeAlbumPhotos(record.photos) ?? [];
  }

  return { record, mergedFields };
}
