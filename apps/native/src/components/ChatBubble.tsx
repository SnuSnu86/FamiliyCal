import React from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  body: string;
  createdAt: number;
  outgoing: boolean;
};

export function ChatBubble({ body, createdAt, outgoing }: Props) {
  return (
    <View style={[styles.row, outgoing ? styles.rowOutgoing : styles.rowIncoming]}>
      <View style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}>
        <Text style={[styles.body, outgoing ? styles.outgoingText : styles.incomingText]}>{body}</Text>
        <Text style={[styles.time, outgoing ? styles.outgoingMeta : styles.incomingMeta]}>
          {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginBottom: 8, paddingHorizontal: 12 },
  rowIncoming: { justifyContent: "flex-start" },
  rowOutgoing: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  incoming: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: StyleSheet.hairlineWidth },
  outgoing: { backgroundColor: "#7D9B84" },
  body: { fontSize: 15, lineHeight: 20 },
  incomingText: { color: "#2A2720" },
  outgoingText: { color: "#FFFFFF" },
  time: { fontSize: 11, marginTop: 4, alignSelf: "flex-end" },
  incomingMeta: { color: "#8A8176" },
  outgoingMeta: { color: "#F5F2EB" },
});
