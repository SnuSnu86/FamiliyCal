import Model from "@nozbe/watermelondb/Model";
import { Associations } from "@nozbe/watermelondb/Model";
import Relation from "@nozbe/watermelondb/Relation";
import { field, relation } from "@nozbe/watermelondb/decorators";
import { Family } from "./Family";
import { User } from "./User";

export class List extends Model {
  static table = "lists";
  static associations: Associations = {
    families: { type: "belongs_to", key: "family_id" },
    users: { type: "belongs_to", key: "creator_id" },
  };

  @field("server_id") serverId?: string | null;
  @field("family_id") familyId!: string;
  @relation("families", "family_id") family!: Relation<Family>;
  @field("creator_id") creatorId!: string;
  @relation("users", "creator_id") creator!: Relation<User>;
  @field("title") title!: string;
  // JSON string (array of items). Parsed/serialized by sync utilities.
  @field("items") items!: string;
}

