import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { ChatBubble } from "../components/ChatBubble";

export default function ChatThreadScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const messages = useQuery(api.chats.listMessages, threadId ? { threadId: threadId as any } : "skip");
  const sendMessage = useMutation(api.chats.sendMessage);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const currentUserId = user?.id;
  const loading = messages === undefined;

  const send = async () => {
    const nextBody = body.trim();
    if (!nextBody || !threadId || isSending) return;
    setIsSending(true);
    try {
      await sendMessage({ threadId: threadId as any, body: nextBody });
      setBody("");
    } catch (error) {
      console.warn("Message send failed", error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Chat</Text>
      </View>

      {loading ? (
        <View style={styles.skeletonStack}>
          <View style={styles.skeletonIncoming} />
          <View style={styles.skeletonOutgoing} />
          <View style={styles.skeletonIncoming} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(item) => String(item._id)}
          renderItem={({ item }) => (
            <ChatBubble
              body={item.body}
              createdAt={item.createdAt}
              outgoing={currentUserId ? item.senderId === currentUserId : false}
            />
          )}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Nachrichten. Schreib die erste Nachricht.</Text>}
          contentContainerStyle={styles.messages}
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel="Nachricht schreiben"
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Nachricht schreiben …"
          placeholderTextColor="#8A8176"
          multiline
        />
        <TouchableOpacity accessibilityRole="button" style={[styles.sendButton, (!body.trim() || isSending) && styles.sendDisabled]} onPress={send} disabled={!body.trim() || isSending}>
          <Text style={styles.sendText}>Senden</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  header: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#E2DDD5" },
  backButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backText: { color: "#5C7C8A", fontWeight: "700" },
  heading: { color: "#2A2720", fontSize: 22, fontWeight: "700" },
  messages: { paddingVertical: 12, flexGrow: 1 },
  skeletonStack: { flex: 1, padding: 16 },
  skeletonIncoming: { width: "60%", height: 54, borderRadius: 12, backgroundColor: "#FBF9F5", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 10 },
  skeletonOutgoing: { width: "64%", height: 54, borderRadius: 12, backgroundColor: "#DDE8D8", alignSelf: "flex-end", marginBottom: 10 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24 },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E2DDD5", backgroundColor: "#FBF9F5" },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, paddingVertical: 10, color: "#2A2720", backgroundColor: "#FFFFFF" },
  sendButton: { minWidth: 76, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  sendDisabled: { opacity: 0.55 },
  sendText: { color: "#FFFFFF", fontWeight: "700" },
});
