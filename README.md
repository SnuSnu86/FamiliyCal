# Fullstack Monorepo Template

This repo is a modern TypeScript monorepo for a shared notes app across web and native.

It currently uses:

- [Turborepo](https://turbo.build/repo)
- [pnpm](https://pnpm.io/)
- [Next.js 16](https://nextjs.org/) with the App Router
- [Expo SDK 55](https://docs.expo.dev/) with Expo Router
- [React 19](https://react.dev/)
- [Convex](https://convex.dev/)
- [Clerk](https://clerk.com/)
- [OpenAI](https://platform.openai.com/docs/quickstart?api-mode=responses) for optional note summaries

## What’s inside

- `apps/web` - the Next.js web app
- `apps/native` - the Expo native app
- `packages/backend` - the Convex backend and generated API types

## Quick start

### 1. Install dependencies

```sh
pnpm install
```

### 2. Configure Convex

Run the backend setup command:

```sh
pnpm --filter @packages/backend setup
```

This will log you into Convex, create or connect a project, and generate `packages/backend/.env.local`.

### 3. Configure Clerk for Convex

Follow the official [Clerk + Convex integration](https://dashboard.clerk.com/apps/setup/convex).

1. In the Clerk dashboard, open **Convex integration** and select **Activate Convex integration**.
2. Confirm **Sessions → Claims** includes `aud = convex` and maps the user's email (claim name `email`, shortcode `{{user.primary_email_address}}`). Without the email claim, Google/OAuth sign-in fails in the native app with „missing an email claim“.
3. Ensure a JWT template named **`convex`** exists (created automatically by the integration wizard).
4. Add your Clerk Frontend API URL to Convex:

```sh
pnpm --filter @packages/backend exec convex env set CLERK_FRONTEND_API_URL https://your-instance.clerk.accounts.dev
```

`packages/backend/convex/auth.config.ts` reads `CLERK_FRONTEND_API_URL` (with optional legacy fallback to `CLERK_JWT_ISSUER_DOMAIN`).

5. Configure the Clerk webhook for account sync on web sign-up:

- Endpoint: `https://your-web-app/api/auth/mapping`
- Events: `user.created`, `user.updated`, `user.deleted`
- Copy the signing secret into `apps/web/.env.local` as `CLERK_WEBHOOK_SECRET`

Native and web clients also call `users.ensureCurrentUser` after sign-in, so local native testing works even before the webhook is reachable. The webhook remains the source of truth for profile updates from Clerk.

If you want native social login, enable Google and Apple in Clerk as well.

If you want AI summaries, also add:

```sh
OPENAI_API_KEY=...
```

to your Convex environment variables.

### 4. Configure the app env files

Create `.env.local` files in `apps/web` and `apps/native` from the provided `.example.env` files.

- Use `CONVEX_URL` from `packages/backend/.env.local` for both `NEXT_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CONVEX_URL`
- Use your Clerk publishable key for both app env files
- Use your Clerk secret key in `apps/web/.env.local`
- Set `CLERK_FRONTEND_API_URL=https://your-instance.clerk.accounts.dev` in all three env files (`packages/backend/.env.local`, `apps/web/.env.local`, `apps/native/.env`)

### 5. Run the apps

```sh
pnpm dev
```

This runs the backend, web app, and native app through Turbo.

## Deploying

From `apps/web`, use Convex to deploy the backend and build the web app:

```sh
cd ../../packages/backend && pnpm exec convex deploy --cmd 'cd ../../apps/web && pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

`apps/web/vercel.json` is already set up for this flow on Vercel.

## Adding dependencies

Install dependencies in the package that actually uses them.

Examples:

```sh
pnpm --filter web-app add mypackage@latest
pnpm --filter native-app add mypackage@latest
pnpm --filter @packages/backend add mypackage@latest
```

## Notes

- The native app uses Expo Router route groups under `apps/native/src/app`
- The web app protects note routes with `apps/web/src/proxy.ts`
- Convex enforces note ownership server-side in `packages/backend/convex/notes.ts`
