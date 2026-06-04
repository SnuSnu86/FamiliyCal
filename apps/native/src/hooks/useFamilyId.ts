import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

/**
 * Resolves the active user's family id from the Convex-mapped user record.
 * This is the canonical source of family membership across the app
 * (see (app)/_layout.tsx). Clerk publicMetadata does NOT carry family_id.
 *
 * Returns `undefined` while the mapping query is still loading or when the
 * user has no family yet.
 */
export function useFamilyId(): string | undefined {
  const { isAuthenticated } = useConvexAuth();
  const mappedUser = useQuery(
    api.users.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  return mappedUser?.familyId ?? undefined;
}
