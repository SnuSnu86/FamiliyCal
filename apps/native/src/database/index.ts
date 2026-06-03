import { Database } from "@nozbe/watermelondb";
import { Platform } from "react-native";

import { Album } from "./models/Album";
import { CalendarEvent } from "./models/CalendarEvent";
import { Family } from "./models/Family";
import { List } from "./models/List";
import { Memo } from "./models/Memo";
import { Note } from "./models/Note";
import { User } from "./models/User";
import { VirtualMember } from "./models/VirtualMember";
import { schema } from "./schema";
import { migrations } from "./migrations";

let adapter;

if (Platform.OS === "web") {
  const LokiJSAdapter = require("@nozbe/watermelondb/adapters/lokijs").default;
  adapter = new LokiJSAdapter({
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
  });
} else {
  const SQLiteAdapter = require("@nozbe/watermelondb/adapters/sqlite").default;
  adapter = new SQLiteAdapter({
    schema,
    migrations,
    dbName: "familycal",
    jsi: Platform.OS === "ios" || Platform.OS === "android",
    onSetUpError: (error: Error) => {
      console.error("WatermelonDB setup failed", error);
    },
  });
}

export const database = new Database({
  adapter,
  modelClasses: [User, Family, Note, CalendarEvent, VirtualMember, Memo, List, Album],
});
