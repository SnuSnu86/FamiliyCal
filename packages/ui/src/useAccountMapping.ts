import { api } from "@packages/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";

export type AccountMappingProfile = {
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
};

export function useAccountMapping(options?: {
  invitationToken?: string | null;
  enabled?: boolean;
  retryKey?: number;
  profile?: AccountMappingProfile;
}) {
  const enabled = options?.enabled ?? true;
  const retryKey = options?.retryKey ?? 0;
  const invitationToken = options?.invitationToken?.trim()
    ? options.invitationToken.trim()
    : undefined;

  const profileEmail = options?.profile?.email?.trim() || undefined;
  const profileName = options?.profile?.name?.trim() || undefined;
  const profileImageUrl = options?.profile?.imageUrl?.trim() || undefined;

  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canQuery = enabled && isAuthenticated;

  const mappedUser = useQuery(
    api.users.getCurrentUser,
    canQuery ? {} : "skip",
  );

  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);

  useEffect(() => {
    setBootstrapFailed(false);
  }, [retryKey]);

  useEffect(() => {
    if (!canQuery || mappedUser !== null || isBootstrapping || bootstrapFailed) {
      return;
    }

    if (mappedUser === undefined) {
      return;
    }

    let cancelled = false;
    setIsBootstrapping(true);

    ensureCurrentUser({
      invitationToken,
      ...(profileEmail ? { email: profileEmail } : {}),
      ...(profileName ? { name: profileName } : {}),
      ...(profileImageUrl ? { imageUrl: profileImageUrl } : {}),
    })
      .catch(() => {
        if (!cancelled) {
          setBootstrapFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapFailed,
    canQuery,
    ensureCurrentUser,
    invitationToken,
    isBootstrapping,
    mappedUser,
    profileEmail,
    profileImageUrl,
    profileName,
    retryKey,
  ]);

  const isWaitingForMapping =
    isConvexAuthLoading ||
    !isAuthenticated ||
    mappedUser === undefined ||
    isBootstrapping ||
    (mappedUser === null && !bootstrapFailed);

  const retryBootstrap = useCallback(() => {
    setBootstrapFailed(false);
  }, []);

  return {
    bootstrapFailed,
    isConvexAuthLoading,
    isConvexAuthenticated: isAuthenticated,
    isWaitingForMapping,
    mappedUser,
    retryBootstrap,
  };
}
