import Model from "@nozbe/watermelondb/Model";
import { Associations } from "@nozbe/watermelondb/Model";
import Relation from "@nozbe/watermelondb/Relation";
import { field, relation } from "@nozbe/watermelondb/decorators";
import { Family } from "./Family";

export class VirtualMember extends Model {
  static table = "virtual_members";
  static associations: Associations = {
    families: { type: "belongs_to", key: "family_id" },
  };

  @field("server_id") serverId?: string;
  @field("family_id") familyId!: string;
  @relation("families", "family_id") family!: Relation<Family>;
  @field("name") name!: string;
  @field("type") type!: string;
  @field("color") color?: string;
}
