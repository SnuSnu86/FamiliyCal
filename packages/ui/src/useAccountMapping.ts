import { api } from "@packages/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";

export function useAccountMapping(options?: {
  invitationToken?: string | null;
  enabled?: boolean;
  retryKey?: number;
}) {
  const enabled = options?.enabled ?? true;
  const retryKey = options?.retryKey ?? 0;
  const invitationToken = options?.invitationToken?.trim()
    ? options.invitationToken.trim()
    : undefined;

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

    ensureCurrentUser({ invitationToken })
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
