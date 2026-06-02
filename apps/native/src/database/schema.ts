import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "users",
      columns: [
        { name: "clerk_id", type: "string", isIndexed: true },
        { name: "email", type: "string" },
        { name: "name", type: "string", isOptional: true },
        { name: "image_url", type: "string", isOptional: true },
        { name: "family_id", type: "string", isOptional: true, isIndexed: true },
        { name: "role", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "families",
      columns: [
        { name: "name", type: "string" },
        { name: "storage_quota", type: "number" },
        { name: "storage_used", type: "number" },
      ],
    }),
    tableSchema({
      name: "notes",
      columns: [
        { name: "user_id", type: "string", isIndexed: true },
        { name: "title", type: "string" },
        { name: "content", type: "string" },
        { name: "summary", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "calendar_events",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "family_id", type: "string", isIndexed: true },
        { name: "creator_id", type: "string", isOptional: true, isIndexed: true },
        { name: "title", type: "string" },
        { name: "description", type: "string", isOptional: true },
        { name: "start_date", type: "string" },
        { name: "end_date", type: "string" },
        { name: "all_day", type: "boolean" },
        { name: "rrule", type: "string", isOptional: true },
        { name: "timezone_id", type: "string", isOptional: true },
        { name: "floating_time", type: "boolean" },
        { name: "veto_status", type: "string", isOptional: true },
        { name: "veto_reason", type: "string", isOptional: true },
        { name: "veto_child_id", type: "string", isOptional: true, isIndexed: true },
        { name: "status", type: "string", isOptional: true },
        { name: "resource_id", type: "string", isOptional: true, isIndexed: true },
      ],
    }),
    tableSchema({
      name: "virtual_members",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "family_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "type", type: "string" },
        { name: "color", type: "string", isOptional: true },
      ],
    }),
  ],
});
