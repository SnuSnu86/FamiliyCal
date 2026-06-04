import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";

import { migrations, modelClasses, schema } from "./common";

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: "familycal",
  jsi: true,
  onSetUpError: (error: Error) => {
    console.error("WatermelonDB setup failed", error);
  },
});

export const database = new Database({
  adapter,
  modelClasses,
});
