import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    console.error(`Story 1.3 verification failed: Missing file ${relativePath}`);
    process.exit(1);
  }
  return readFileSync(absolutePath, "utf8");
}

function expectIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    failures.push(message);
  }
}

const schema = read("packages/backend/convex/schema.ts");
expectIncludes(schema, "families: defineTable({", "schema.ts must define families table");
expectIncludes(schema, "name: v.string()", "families table must include name: v.string()");
expectIncludes(schema, "storageQuota: v.number()", "families table must include storageQuota: v.number()");
expectIncludes(schema, "storageUsed: v.number()", "families table must include storageUsed: v.number()");
expectIncludes(schema, "createdAt: v.number()", "families table must include createdAt: v.number()");

const families = read("packages/backend/convex/families.ts");
expectIncludes(families, "export const create = mutation", "families.ts must export create mutation");
expectIncludes(families, "export const getFamily = query", "families.ts must export getFamily query");
expectIncludes(families, "ctx.auth.getUserIdentity()", "create mutation must check Convex auth identity");
expectIncludes(families, "Benutzer gehört bereits einer Familie an", "create mutation must reject users with an existing familyId");
expectIncludes(families, "role: FAMILY_OWNER_ROLE", "create mutation must set owner role");
expectIncludes(families, "storageQuota: DEFAULT_STORAGE_QUOTA_BYTES", "create mutation must set the 2GB quota");
expectIncludes(families, "storageUsed: 0", "create mutation must initialize storageUsed to 0");
expectIncludes(families, "createdAt: Date.now()", "create mutation must set createdAt with server time");

const requiredFiles = [
  "apps/web/src/components/family/CreateFamily.tsx",
  "apps/native/src/screens/CreateFamilyScreen.tsx",
];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing file: ${file}`);
  }
}

const webNotes = read("apps/web/src/components/notes/Notes.tsx");
expectIncludes(webNotes, "<CreateFamily />", "Notes.tsx must render CreateFamily for users without familyId");
expectIncludes(webNotes, "!mappedUser.familyId", "Notes.tsx must check for missing familyId");

const nativeLayout = read("apps/native/src/app/(app)/_layout.tsx");
expectIncludes(nativeLayout, "\"/create-family\"", "Native layout must redirect to /create-family for users without familyId");
expectIncludes(nativeLayout, "!mappedUser.familyId", "Native layout must check for missing familyId");

if (failures.length > 0) {
  console.error("Story 1.3 verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Story 1.3 verification passed.");
