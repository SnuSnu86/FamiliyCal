import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const mustExist = [
  '.gitignore',
  'apps/native',
  'apps/web',
  'packages/backend',
  'packages/shared',
  'packages/ui',
  'packages/backend/convex/schema.ts',
  'apps/web/src/app/layout.tsx',
  'apps/native/src/app/_layout.tsx',
  'apps/web/.env.local',
  'apps/native/.env',
];

for (const path of mustExist) {
  if (!existsSync(join(root, path))) throw new Error(`Missing required path: ${path}`);
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in file ${path}: ${err.message}`);
  }
};

const rootPkg = readJson('package.json');
const webPkg = readJson('apps/web/package.json');
const nativePkg = readJson('apps/native/package.json');
const backendPkg = readJson('packages/backend/package.json');
const sharedPkg = readJson('packages/shared/package.json');
const uiPkg = readJson('packages/ui/package.json');

if (rootPkg.name !== 'familycal') throw new Error('Root package name must be familycal');
if (!rootPkg.scripts?.dev?.includes('turbo run dev')) throw new Error('Root dev script must run turbo dev');
if (!webPkg.dependencies || webPkg.dependencies.convex !== '1.39.1') throw new Error('apps/web convex must be pinned to 1.39.1');
if (!backendPkg.dependencies || backendPkg.dependencies.convex !== '1.39.1') throw new Error('packages/backend convex must be pinned to 1.39.1');
if (!nativePkg.dependencies || nativePkg.dependencies.zustand !== '5.0.14') throw new Error('apps/native zustand must be pinned to 5.0.14');
if (!nativePkg.dependencies || nativePkg.dependencies['@clerk/expo'] !== '3.3.0') throw new Error('@clerk/expo must be pinned to 3.3.0');
if (backendPkg.name !== '@packages/backend') throw new Error('Backend package name mismatch');
if (sharedPkg.name !== '@packages/shared') throw new Error('Shared package name mismatch');
if (uiPkg.name !== '@packages/ui') throw new Error('UI package name mismatch');

const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
if (!gitignore.includes('convex/_generated/')) throw new Error('convex/_generated/ must be gitignored');

const checkEnvKeyVal = (envContent, key, filepath) => {
  const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) throw new Error(`Missing ${key} in ${filepath}`);
  if (!match[1].trim()) throw new Error(`Empty value for ${key} in ${filepath}`);
};

const webEnv = readFileSync(join(root, 'apps/web/.env.local'), 'utf8');
for (const key of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'NEXT_PUBLIC_CONVEX_URL']) {
  checkEnvKeyVal(webEnv, key, 'apps/web/.env.local');
}
const nativeEnv = readFileSync(join(root, 'apps/native/.env'), 'utf8');
for (const key of ['EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', 'EXPO_PUBLIC_CONVEX_URL']) {
  checkEnvKeyVal(nativeEnv, key, 'apps/native/.env');
}

console.log('Story 1.1 verification passed');
