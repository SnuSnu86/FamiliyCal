import { useAuth, useUser } from "@clerk/expo";
import { useAccountMapping } from "@packages/ui";
import { api } from "@packages/backend/convex/_generated/api";
import { useConvex, useMutation } from "convex/react";
import * as Linking from "expo-linking";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ConvexError } from "convex/values";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Platform, Alert } from "react-native";

const setInvitationToken = async (token: string) => {
  if (Platform.OS === "web") {
    try {
      localStorage.setItem("invitationToken", token);
    } catch {}
  } else {
    await SecureStore.setItemAsync("invitationToken", token).catch(() => null);
  }
};

const getInvitationToken = async (): Promise<string | null> => {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem("invitationToken");
    } catch {
      return null;
    }
  } else {
    return await SecureStore.getItemAsync("invitationToken").catch(() => null);
  }
};

const deleteInvitationToken = async () => {
  if (Platform.OS === "web") {
    try {
      localStorage.removeItem("invitationToken");
    } catch {}
  } else {
    await SecureStore.deleteItemAsync("invitationToken").catch(() => null);
  }
};

export default function AppLayout() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();

  // Listen to deep links when user is signed out
  useEffect(() => {
    async function handleInitialUrl() {
      if (isSignedIn) return;
      const url = await Linking.getInitialURL();
      if (url) {
        await handleUrl(url);
      }
    }

    async function handleUrl(url: string) {
      if (isSignedIn) return;
      const parsed = Linking.parse(url);
      const token = typeof parsed.queryParams?.token === "string" ? parsed.queryParams.token : undefined;
      if (token) {
        await setInvitationToken(token);
      }
    }

    handleInitialUrl();
    const subscription = Linking.addEventListener("url", async (event) => {
      await handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [isSignedIn]);

  if (!isAuthLoaded || !isUserLoaded) return null;

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return <MappingWrapper clerkId={user?.id} user={user!} />;
}

type MappingWrapperProps = {
  clerkId?: string;
  user: NonNullable<ReturnType<typeof useUser>["user"]>;
};

function MappingWrapper({ clerkId, user }: MappingWrapperProps) {
  const segments = useSegments();
  const convexClient = useConvex();
  const [timeoutReached, setTimeoutReached] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [isProcessingInvite, setIsProcessingInvite] = useState(false);
  const [storedInviteToken, setStoredInviteToken] = useState<string | null>(null);
  const [inviteTokenLoaded, setInviteTokenLoaded] = useState(false);
  const acceptInvitation = useMutation(api.invitations.acceptInvitation);
  const processedTokens = useRef(new Set<string>());
  const isComponentMounted = useRef(true);
  const initialUrlChecked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getInvitationToken().then((token) => {
      if (!cancelled) {
        setStoredInviteToken(token);
        setInviteTokenLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const {
    bootstrapFailed,
    isWaitingForMapping: isWaitingForAccount,
    mappedUser,
    retryBootstrap,
  } = useAccountMapping({
    enabled: inviteTokenLoaded,
    invitationToken: storedInviteToken,
    retryKey,
    profile: user
      ? {
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName,
          imageUrl: user.imageUrl,
        }
      : undefined,
  });

  const isWaitingForMapping =
    isWaitingForAccount || isProcessingInvite || !inviteTokenLoaded;

  // Start background auto-sync for Memos, Lists, and Albums
  useEffect(() => {
    if (clerkId === undefined) return;
    const { startMemoListAutoSync } = require("../../sync/memoListSync");
    const { database } = require("../../database");
    const unsubscribe = startMemoListAutoSync({ db: database, convexClient });
    return () => unsubscribe();
  }, [clerkId, convexClient]);

  // Start background auto-sync for key verifications (6-4 AC4) so the offline
  // "Verifiziert" badge cache stays consistent with the server on reconnect.
  useEffect(() => {
    if (!clerkId) return;
    const { startKeyVerificationAutoSync } = require("../../sync/keyVerificationSync");
    const { database } = require("../../database");
    const unsubscribe = startKeyVerificationAutoSync({ db: database, convexClient, verifierId: clerkId });
    return () => unsubscribe();
  }, [clerkId, convexClient]);

  useEffect(() => {
    return () => {
      isComponentMounted.current = false;
    };
  }, []);

  // Cleanup stale invitation tokens when user is already in a family
  useEffect(() => {
    if (mappedUser && mappedUser.familyId) {
      deleteInvitationToken().catch((error) => console.warn("Failed to delete invitation token", error));
    }
  }, [mappedUser]);

  useEffect(() => {
    async function acceptDeepLinkInvite() {
      let token = await getInvitationToken();

      if (!token) {
        const url = await Linking.getInitialURL();
        if (url) {
          const parsed = Linking.parse(url);
          token = typeof parsed.queryParams?.token === "string" ? parsed.queryParams.token : null;
        }
      }

      if (!token || !isComponentMounted.current || !mappedUser || mappedUser.familyId) return;
      if (processedTokens.current.has(token)) return;
      processedTokens.current.add(token);

      setIsProcessingInvite(true);
      try {
        await acceptInvitation({ token });
      } catch (error: any) {
        console.error("Failed to accept invitation:", error);
        const message = error instanceof ConvexError
          ? error.message
          : "Die Einladung konnte nicht geladen werden. Bitte überprüfe deine Internetverbindung.";
        if (Platform.OS === "web") {
          alert(`Fehler: ${message}`);
        } else {
          Alert.alert("Einladung fehlgeschlagen", message);
        }
      } finally {
        await deleteInvitationToken();
        if (isComponentMounted.current) setIsProcessingInvite(false);
      }
    }

    if (!initialUrlChecked.current && mappedUser !== undefined) {
      initialUrlChecked.current = true;
      acceptDeepLinkInvite();
    }

    const subscription = Linking.addEventListener("url", async (event) => {
      if (!isComponentMounted.current || !mappedUser || mappedUser.familyId) return;
      const parsed = Linking.parse(event.url);
      const token = typeof parsed.queryParams?.token === "string" ? parsed.queryParams.token : undefined;
      if (token) {
        if (processedTokens.current.has(token)) return;
        processedTokens.current.add(token);

        setIsProcessingInvite(true);
        try {
          await acceptInvitation({ token });
        } catch (error: any) {
          console.error("Failed to accept invitation from warm start:", error);
          const message = error instanceof ConvexError
            ? error.message
            : "Die Einladung konnte nicht geladen werden. Bitte überprüfe deine Internetverbindung.";
          if (Platform.OS === "web") {
            alert(`Fehler: ${message}`);
          } else {
            Alert.alert("Einladung fehlgeschlagen", message);
          }
        } finally {
          await deleteInvitationToken();
          if (isComponentMounted.current) setIsProcessingInvite(false);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [acceptInvitation, mappedUser]);

  useEffect(() => {
    if (!isWaitingForMapping) {
      setTimeoutReached(false);
      return;
    }
    const timer = setTimeout(() => {
      if (isWaitingForMapping) {
        setTimeoutReached(true);
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [isWaitingForMapping, retryKey]);

  const isOnboarding = (segments as readonly string[]).includes("create-family");

  if (isWaitingForMapping) {
    if (timeoutReached || bootstrapFailed) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Verbindung fehlgeschlagen</Text>
          <Text style={styles.errorText}>
            {bootstrapFailed
              ? "Clerk und Convex konnten nicht verbunden werden. In Clerk: Convex-Integration aktivieren, Sessions → Claims mit aud = convex und E-Mail (email), dann erneut anmelden."
              : "Dein Konto konnte nicht mit FamilyCal synchronisiert werden. Bitte prüfe deine Internetverbindung und melde dich erneut an."}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setTimeoutReached(false);
              retryBootstrap();
              setRetryKey((prev) => prev + 1);
            }}
          >
            <Text style={styles.retryButtonText}>Erneut versuchen</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.skeletonContainer}>
        <View style={styles.skeletonHeader}>
          <ActivityIndicator size="small" color="#0D87E1" />
        </View>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSearch} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
        <Text style={styles.skeletonText}>
          Dein Konto wird sicher mit FamilyCal verbunden …
        </Text>
      </View>
    );
  }

  if (mappedUser && !mappedUser.familyId) {
    if (!isOnboarding) {
      return <Redirect href="/create-family" />;
    }
  } else if (mappedUser && mappedUser.familyId && isOnboarding) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.appShell}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="event-editor" options={{ presentation: "modal" }} />
        <Stack.Screen name="voice-input" options={{ presentation: "modal" }} />
        <Stack.Screen name="e2e-setup" />
        <Stack.Screen name="key-verification" />
        <Stack.Screen name="chats" />
        <Stack.Screen name="chat/[threadId]" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#F5F2EB",
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  errorTitle: {
    fontSize: 20,
    color: "#D32F2F",
    marginBottom: 12,
    fontFamily: "System",
    fontWeight: "bold",
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    color: "#6F675E",
    marginBottom: 28,
    textAlign: "center",
    fontFamily: "System",
  },
  skeletonContainer: {
    flex: 1,
    backgroundColor: "#F5F2EB",
    padding: 20,
    justifyContent: "center",
  },
  skeletonHeader: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#FBF9F5",
    borderWidth: 1,
    borderColor: "#E2DDD5",
    marginBottom: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  skeletonTitle: {
    alignSelf: "center",
    width: "45%",
    height: 28,
    borderRadius: 10,
    backgroundColor: "#FBF9F5",
    marginBottom: 28,
  },
  skeletonSearch: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#FBF9F5",
    borderWidth: 1,
    borderColor: "#E2DDD5",
    marginBottom: 18,
  },
  skeletonCard: {
    height: 72,
    borderRadius: 14,
    backgroundColor: "#FBF9F5",
    borderWidth: 1,
    borderColor: "#E2DDD5",
    marginBottom: 12,
  },
  skeletonText: {
    textAlign: "center",
    color: "#6F675E",
    fontFamily: "System",
    marginTop: 10,
  },
  retryButton: {
    backgroundColor: "#0D87E1",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: "center",
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
    fontFamily: "System",
    fontWeight: "bold",
  },
});
