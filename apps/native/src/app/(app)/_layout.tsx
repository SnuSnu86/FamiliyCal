import { useAuth, useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Redirect, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";

export default function AppLayout() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();

  if (!isAuthLoaded || !isUserLoaded) return null;

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return <MappingWrapper clerkId={user?.id} />;
}

function MappingWrapper({ clerkId }: { clerkId?: string }) {
  const [timeoutReached, setTimeoutReached] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const mappedUser = useQuery(
    api.users.getUserByClerkId,
    clerkId ? { clerkId } : "skip"
  );

  const isWaitingForMapping = mappedUser === null || mappedUser === undefined;

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

  if (isWaitingForMapping) {
    if (timeoutReached) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Verbindung fehlgeschlagen</Text>
          <Text style={styles.errorText}>
            Dein Konto konnte nicht mit FamilyCal synchronisiert werden. Bitte prüfe deine Internetverbindung.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setTimeoutReached(false);
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

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
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
