import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";

import { migrations, modelClasses, schema } from "./common";

const adapter = new LokiJSAdapter({
  schema,
  migrations,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
});

export const database = new Database({
  adapter,
  modelClasses,
});
