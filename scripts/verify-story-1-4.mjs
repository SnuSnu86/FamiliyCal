import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const checks = [];
function file(path) {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  return readFileSync(path, "utf8");
}
function check(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
  if (!condition) throw new Error(`Verification failed: ${name}`);
}

const schema = file("packages/backend/convex/schema.ts");
check("schema defines invitations table", schema.includes("invitations: defineTable"));
check("schema has by_token index", schema.includes('.index("by_token", ["token"])'));
check("schema includes invitation role literals", ["ROLE-002", "ROLE-003", "ROLE-004", "ROLE-005", "ROLE-006"].every((role) => schema.includes(`v.literal("${role}")`)));

const invitations = file("packages/backend/convex/invitations.ts");
for (const exportName of ["createInvitation", "getInvitationByToken", "acceptInvitation", "listInvitations", "cancelInvitation"]) {
  check(`invitations exports ${exportName}`, invitations.includes(`export const ${exportName}`));
}
check("invitations uses ConvexError", invitations.includes("ConvexError"));
check("invitations checks admin roles", invitations.includes("ROLE-001") && invitations.includes("ROLE-002"));

const users = file("packages/backend/convex/users.ts");
check("users accepts invitationToken", users.includes("invitationToken: v.optional(v.string())"));
check("users falls back to invitation email", users.includes("by_email"));
check("users marks invitation accepted", users.includes('status: "accepted"'));
check("users lists family members", users.includes("export const listFamilyMembers"));

const webhook = file("apps/web/src/app/api/auth/mapping/route.ts");
check("webhook reads public_metadata token", webhook.includes("public_metadata?.invitationToken"));
check("webhook reads unsafe_metadata token", webhook.includes("unsafe_metadata?.invitationToken"));
check("webhook sends invitationToken to Convex", webhook.includes("invitationToken: getInvitationToken(data)"));

for (const path of [
  "apps/web/src/components/family/FamilySettings.tsx",
  "apps/web/src/app/settings/page.tsx",
  "apps/web/src/app/invite/page.tsx",
  "apps/native/src/screens/FamilySettingsScreen.tsx",
  "apps/native/src/app/(app)/settings.tsx",
]) file(path);

check("web nav links settings", file("apps/web/src/components/common/UserNav.tsx").includes('href="/settings"'));
check("native dashboard links settings", file("apps/native/src/screens/NotesDashboardScreen.tsx").includes('/settings'));
check("native layout parses deeplink token", file("apps/native/src/app/(app)/_layout.tsx").includes("Linking.parse"));

for (const command of ["pnpm typecheck"]) {
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    throw new Error(`${command} failed`);
  }
}

console.log(`Story 1.4 verification passed (${checks.length} checks).`);
