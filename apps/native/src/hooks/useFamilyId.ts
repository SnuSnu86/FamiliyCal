import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";

/**
 * Resolves the active user's family id from the Convex-mapped user record.
 * This is the canonical source of family membership across the app
 * (see (app)/_layout.tsx). Clerk publicMetadata does NOT carry family_id.
 *
 * Returns `undefined` while the mapping query is still loading or when the
 * user has no family yet.
 */
export function useFamilyId(): string | undefined {
  const { user } = useUser();
  const mappedUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );
  return mappedUser?.familyId ?? undefined;
}
