import { existsSync, readFileSync } from "node:fs";

const checks = [];

function check(description, condition) {
  checks.push({ description, condition: Boolean(condition) });
}

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const schema = read("packages/backend/convex/schema.ts");
const users = read("packages/backend/convex/users.ts");
const route = read("apps/web/src/app/api/auth/mapping/route.ts");
const proxy = read("apps/web/src/proxy.ts");
const webNotes = read("apps/web/src/components/notes/Notes.tsx");
const nativeLayout = read("apps/native/src/app/(app)/_layout.tsx");
const envExample = read("apps/web/.example.env");

check("Convex users table exists", /users:\s*defineTable/.test(schema));
check("users.by_clerkId index exists", /\.index\("by_clerkId", \["clerkId"\]\)/.test(schema));
check("users.by_familyId index exists", /\.index\("by_familyId", \["familyId"\]\)/.test(schema));
check("families dummy table exists", /families:\s*defineTable\(\{\s*name:\s*v\.string\(\)/s.test(schema));
check("upsertUserFromWebhook mutation exists", /export const upsertUserFromWebhook = mutation/.test(users));
check("default ROLE-003 is assigned", /DEFAULT_ROLE\s*=\s*"ROLE-003"/.test(users));
check("getUserByClerkId query exists", /export const getUserByClerkId = query/.test(users));
check("deleteUserFromWebhook mutation exists", /export const deleteUserFromWebhook = mutation/.test(users));
check("Webhook route exists", existsSync("apps/web/src/app/api/auth/mapping/route.ts"));
check("Webhook uses Clerk signature verification", /verifyWebhook/.test(route));
check("Webhook requires CLERK_WEBHOOK_SECRET", /CLERK_WEBHOOK_SECRET/.test(route));
check("Webhook uses ConvexHttpClient", /ConvexHttpClient/.test(route));
check("Webhook handles user.created", /user\.created/.test(route));
check("Webhook handles user.updated", /user\.updated/.test(route));
check("Webhook handles user.deleted", /user\.deleted/.test(route));
check("Proxy does not protect webhook route", !/api\/auth\/mapping/.test(proxy) && /matcher:\s*\["\/notes\/:path\*"\]/.test(proxy));
check("Web client polls mapping query", /api\.users\.getUserByClerkId/.test(webNotes));
check("Web client has skeleton loader", /MappingSkeleton/.test(webNotes) && /#F5F2EB/.test(webNotes));
check("Native client polls mapping query", /api\.users\.getUserByClerkId/.test(nativeLayout));
check("Native client has skeleton loader", /skeletonContainer/.test(nativeLayout) && /#F5F2EB/.test(nativeLayout));
check("Example env documents CLERK_WEBHOOK_SECRET", /CLERK_WEBHOOK_SECRET/.test(envExample));

const failed = checks.filter((item) => !item.condition);

for (const item of checks) {
  console.log(`${item.condition ? "✓" : "✗"} ${item.description}`);
}

if (failed.length > 0) {
  console.error(`\nStory 1.2 verification failed: ${failed.length} checks failed.`);
  process.exit(1);
}

console.log("\nStory 1.2 verification passed.");
