import { field } from "@nozbe/watermelondb/decorators";
import { Model } from "@nozbe/watermelondb";

export class KeyVerification extends Model {
  static table = "key_verifications";

  @field("server_id") serverId?: string;
  @field("verifier_id") verifierId!: string;
  @field("verified_user_id") verifiedUserId!: string;
  @field("public_key") publicKey!: string;
  @field("fingerprint") fingerprint!: string;
}
