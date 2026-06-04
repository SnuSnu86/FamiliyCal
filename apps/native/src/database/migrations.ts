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
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: "users",
          columns: [
            { name: "public_key", type: "string", isOptional: true },
            { name: "encrypted_private_key", type: "string", isOptional: true },
          ],
        }),
        addColumns({
          table: "calendar_events",
          columns: [
            { name: "is_private", type: "boolean", isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        createTable({
          name: "key_verifications",
          columns: [
            { name: "server_id", type: "string", isOptional: true, isIndexed: true },
            { name: "verifier_id", type: "string", isIndexed: true },
            { name: "verified_user_id", type: "string", isIndexed: true },
            { name: "public_key", type: "string" },
            { name: "fingerprint", type: "string" },
          ],
        }),
      ],
    },
  ],
});
