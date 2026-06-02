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
