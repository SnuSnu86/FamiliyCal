import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { type Href, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ChatListScreen() {
  const router = useRouter();
  const { user } = useUser();
  const members = useQuery(api.users.listFamilyMembers);
  const threads = useQuery(api.chats.listThreads);
  const ensureGroupThread = useMutation(api.chats.ensureFamilyGroupThread);
  const getOrCreateDirectThread = useMutation(api.chats.getOrCreateDirectThread);

  useEffect(() => {
    ensureGroupThread({}).catch((error) => console.warn("Group chat setup failed", error));
  }, [ensureGroupThread]);

  const groupThread = threads?.find((thread) => thread.type === "group");
  const directThreads = threads?.filter((thread) => thread.type === "direct") ?? [];

  const openGroup = async () => {
    const thread = groupThread ?? await ensureGroupThread({});
    if (thread?._id) router.push(`/chat/${thread._id}` as Href);
  };

  const openDirect = async (targetUserId: string) => {
    try {
      const thread = await getOrCreateDirectThread({ targetUserId });
      if (thread?._id) router.push(`/chat/${thread._id}` as Href);
    } catch (error) {
      console.warn("Direct chat failed", error);
    }
  };

  const loading = members === undefined || threads === undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Chats</Text>
        <Text style={styles.subheading}>Familiengruppe und 1:1-Nachrichten</Text>
      </View>

      {loading ? (
        <View style={styles.skeletonStack}>
          <View style={styles.skeletonCard} />
          <View style={styles.skeletonCard} />
          <View style={styles.skeletonCard} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              <Text style={styles.sectionTitle}>Familienchat</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={openGroup}>
                <Text style={styles.cardTitle}>Familienchat</Text>
                <Text style={styles.cardMeta}>{groupThread?.lastMessagePreview ?? "Gemeinsamer Gruppenchat"}</Text>
              </TouchableOpacity>
              <Text style={styles.sectionTitle}>1:1-Chats</Text>
            </>
          }
          data={(members ?? []).filter((member) => member.clerkId !== user?.id)}
          keyExtractor={(item) => item.clerkId}
          renderItem={({ item }) => {
            const existing = directThreads.find((thread) => thread.participantIds.includes(item.clerkId));
            return (
              <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => openDirect(item.clerkId)}>
                <Text style={styles.cardTitle}>{item.name ?? item.email}</Text>
                <Text style={styles.cardMeta}>{existing?.lastMessagePreview ?? "Direktchat starten"}</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Familienmitglieder verfügbar.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  header: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 },
  heading: { color: "#2A2720", fontSize: 24, fontWeight: "700" },
  subheading: { color: "#5C7C8A", marginTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { color: "#2A2720", fontSize: 16, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  card: { minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 12, justifyContent: "center", marginBottom: 10 },
  cardTitle: { color: "#2A2720", fontSize: 16, fontWeight: "700" },
  cardMeta: { color: "#6F675E", marginTop: 4 },
  skeletonStack: { padding: 16 },
  skeletonCard: { height: 72, borderRadius: 14, backgroundColor: "#FBF9F5", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 12 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24 },
});
