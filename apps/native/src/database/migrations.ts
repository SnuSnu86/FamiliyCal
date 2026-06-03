import { schemaMigrations, addColumns, createTable } from "@nozbe/watermelondb/Schema/migrations";

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: "users",
          columns: [
            { name: "storage_limit", type: "number", isOptional: true },
          ],
        }),
        createTable({
          name: "memos",
          columns: [
            { name: "server_id", type: "string", isOptional: true, isIndexed: true },
            { name: "family_id", type: "string", isIndexed: true },
            { name: "creator_id", type: "string", isIndexed: true },
            { name: "title", type: "string" },
            { name: "content", type: "string" },
          ],
        }),
        createTable({
          name: "lists",
          columns: [
            { name: "server_id", type: "string", isOptional: true, isIndexed: true },
            { name: "family_id", type: "string", isIndexed: true },
            { name: "creator_id", type: "string", isIndexed: true },
            { name: "title", type: "string" },
            { name: "items", type: "string" },
          ],
        }),
        createTable({
          name: "albums",
          columns: [
            { name: "server_id", type: "string", isOptional: true, isIndexed: true },
            { name: "family_id", type: "string", isIndexed: true },
            { name: "creator_id", type: "string", isIndexed: true },
            { name: "name", type: "string" },
            { name: "photos", type: "string" },
          ],
        }),
      ],
    },
  ],
});
