import { Album } from "./models/Album";
import { CalendarEvent } from "./models/CalendarEvent";
import { Family } from "./models/Family";
import { List } from "./models/List";
import { Memo } from "./models/Memo";
import { Note } from "./models/Note";
import { User } from "./models/User";
import { VirtualMember } from "./models/VirtualMember";
import { migrations } from "./migrations";
import { schema } from "./schema";

export { schema, migrations };

export const modelClasses = [
  User,
  Family,
  Note,
  CalendarEvent,
  VirtualMember,
  Memo,
  List,
  Album,
];
