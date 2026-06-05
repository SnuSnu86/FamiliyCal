import Model from "@nozbe/watermelondb/Model";
import { Associations } from "@nozbe/watermelondb/Model";
import Relation from "@nozbe/watermelondb/Relation";
import { field, relation } from "@nozbe/watermelondb/decorators";
import { Family } from "./Family";
import { User } from "./User";

export class CalendarEvent extends Model {
  static table = "calendar_events";
  static associations: Associations = {
    families: { type: "belongs_to", key: "family_id" },
    users: { type: "belongs_to", key: "creator_id" },
  };

  @field("server_id") serverId?: string | null;
  @field("client_id") clientId?: string | null;
  @field("family_id") familyId!: string;
  @relation("families", "family_id") family!: Relation<Family>;
  @field("creator_id") creatorId?: string;
  @relation("users", "creator_id") creator!: Relation<User>;
  @field("title") title!: string;
  @field("description") description?: string;
  @field("start_date") startDate!: string;
  @field("end_date") endDate!: string;
  @field("all_day") allDay!: boolean;
  @field("rrule") rrule?: string;
  @field("timezone_id") timezoneId?: string;
  @field("floating_time") floatingTime!: boolean;
  @field("is_private") isPrivate?: boolean;
  @field("veto_status") vetoStatus?: string;
  @field("veto_reason") vetoReason?: string;
  @field("veto_child_id") vetoChildId?: string;
  @field("status") status?: string;
  @field("resource_id") resourceId?: string;
}
