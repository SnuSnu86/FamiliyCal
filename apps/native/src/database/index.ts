import { Database } from "@nozbe/watermelondb";
import { Platform } from "react-native";

import { CalendarEvent } from "./models/CalendarEvent";
import { Family } from "./models/Family";
import { Note } from "./models/Note";
import { User } from "./models/User";
import { VirtualMember } from "./models/VirtualMember";
import { schema } from "./schema";

let adapter;

if (Platform.OS === "web") {
  const LokiJSAdapter = require("@nozbe/watermelondb/adapters/lokijs").default;
  adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
  });
} else {
  const SQLiteAdapter = require("@nozbe/watermelondb/adapters/sqlite").default;
  adapter = new SQLiteAdapter({
    schema,
    dbName: "familycal",
    jsi: Platform.OS === "ios" || Platform.OS === "android",
    onSetUpError: (error: Error) => {
      console.error("WatermelonDB setup failed", error);
    },
  });
}

export const database = new Database({
  adapter,
  modelClasses: [User, Family, Note, CalendarEvent, VirtualMember],
});
