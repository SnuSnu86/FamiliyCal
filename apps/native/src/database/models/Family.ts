import Model from "@nozbe/watermelondb/Model";
import type { Associations } from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export class Family extends Model {
  static table = "families";
  static associations: Associations = {
    users: { type: "has_many", foreignKey: "family_id" },
    calendar_events: { type: "has_many", foreignKey: "family_id" },
    virtual_members: { type: "has_many", foreignKey: "family_id" },
  };

  @field("name") name!: string;
  @field("storage_quota") storageQuota!: number;
  @field("storage_used") storageUsed!: number;
}
