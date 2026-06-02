import Model from "@nozbe/watermelondb/Model";
import { Associations } from "@nozbe/watermelondb/Model";
import Relation from "@nozbe/watermelondb/Relation";
import { field, relation } from "@nozbe/watermelondb/decorators";
import { Family } from "./Family";

export class User extends Model {
  static table = "users";
  static associations: Associations = {
    families: { type: "belongs_to", key: "family_id" },
    notes: { type: "has_many", foreignKey: "user_id" },
  };

  @field("clerk_id") clerkId!: string;
  @field("email") email!: string;
  @field("name") name?: string;
  @field("image_url") imageUrl?: string;
  @field("family_id") familyId?: string;
  @relation("families", "family_id") family!: Relation<Family>;
  @field("role") role?: string;
}
