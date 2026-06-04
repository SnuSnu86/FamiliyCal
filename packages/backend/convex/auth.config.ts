import { type AuthConfig } from "convex/server";

function clerkFrontendApiUrl(): string {
  const raw =
    process.env.CLERK_FRONTEND_API_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;

  if (!raw?.trim()) {
    throw new Error(
      "Missing CLERK_FRONTEND_API_URL in Convex environment variables",
    );
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export default {
  providers: [
    {
      domain: clerkFrontendApiUrl(),
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
