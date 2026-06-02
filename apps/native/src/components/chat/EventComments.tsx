import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { ChatBubble } from "../ChatBubble";

type Props = {
  calendarEventId?: string | null;
};

export function EventComments({ calendarEventId }: Props) {
  const { user } = useUser();
  const messages = useQuery(api.chats.listEventMessages, calendarEventId ? { calendarEventId: calendarEventId as any } : "skip");
  const ensureEventThread = useMutation(api.chats.ensureEventThread);
  const sendEventComment = useMutation(api.chats.sendEventComment);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!calendarEventId) return;
    ensureEventThread({ calendarEventId: calendarEventId as any }).catch((error) => {
      console.warn("Event comment thread setup failed", error);
      setErrorText("Kommentare konnten gerade nicht vorbereitet werden.");
    });
  }, [calendarEventId, ensureEventThread]);

  if (!calendarEventId) {
    return <Text style={styles.syncHint}>Kommentare sind verfügbar, sobald der Termin synchronisiert ist.</Text>;
  }

  const send = async () => {
    const nextBody = body.trim();
    if (!nextBody || isSending) return;

    setIsSending(true);
    setErrorText(null);
    try {
      await sendEventComment({ calendarEventId: calendarEventId as any, body: nextBody });
      setBody("");
    } catch (error) {
      console.warn("Event comment send failed", error);
      setErrorText("Kommentar konnte nicht gesendet werden. Bitte versuche es gleich noch einmal.");
    } finally {
      setIsSending(false);
    }
  };

  const loading = messages === undefined;

  return (
    <View accessibilityLabel="Kommentare zum Termin" style={styles.container}>
      <Text style={styles.title}>Kommentare</Text>
      {loading ? (
        <View style={styles.skeletonStack}>
          <View style={styles.skeletonIncoming} />
          <View style={styles.skeletonOutgoing} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(item) => String(item._id)}
          renderItem={({ item }) => (
            <ChatBubble body={item.body} createdAt={item.createdAt} outgoing={user?.id ? item.senderId === user.id : false} />
          )}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Kommentare zu diesem Termin.</Text>}
          contentContainerStyle={styles.messages}
        />
      )}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel="Kommentar schreiben"
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Kommentar schreiben …"
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
  container: { marginTop: 12, minHeight: 220, maxHeight: 360, borderTopWidth: 1, borderTopColor: "#E2DDD5", paddingTop: 12 },
  title: { color: "#2A2720", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  syncHint: { color: "#5C7C8A", marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#F5F2EB" },
  messages: { paddingVertical: 4, flexGrow: 1 },
  skeletonStack: { minHeight: 96, paddingVertical: 4 },
  skeletonIncoming: { width: "68%", height: 48, borderRadius: 12, backgroundColor: "#F5F2EB", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 8 },
  skeletonOutgoing: { width: "62%", height: 48, borderRadius: 12, backgroundColor: "#DDE8D8", alignSelf: "flex-end", marginBottom: 8 },
  empty: { color: "#2A2720", textAlign: "center", padding: 16 },
  error: { color: "#8A3B2F", marginTop: 4 },
  inputRow: { flexDirection: "row", gap: 8, paddingTop: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 96, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, paddingVertical: 10, color: "#2A2720", backgroundColor: "#FFFFFF" },
  sendButton: { minWidth: 76, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  sendDisabled: { opacity: 0.55 },
  sendText: { color: "#FFFFFF", fontWeight: "700" },
});
