import Model from "@nozbe/watermelondb/Model";
import { Associations } from "@nozbe/watermelondb/Model";
import Relation from "@nozbe/watermelondb/Relation";
import { field, relation } from "@nozbe/watermelondb/decorators";
import { User } from "./User";

export class Note extends Model {
  static table = "notes";
  static associations: Associations = {
    users: { type: "belongs_to", key: "user_id" },
  };

  @field("user_id") userId!: string;
  @relation("users", "user_id") user!: Relation<User>;
  @field("title") title!: string;
  @field("content") content!: string;
  @field("summary") summary?: string;
}
