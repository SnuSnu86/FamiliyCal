import React from "react";
import { StyleSheet, Text, View, Image, TouchableOpacity, Modal, Pressable, Linking } from "react-native";

type Props = {
  body: string;
  createdAt: number;
  outgoing: boolean;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileUrl?: string;
};

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = 1;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function ChatBubble({ body, createdAt, outgoing, fileName, fileType, fileSize, fileUrl }: Props) {
  const [modalVisible, setModalVisible] = React.useState(false);

  const isImage = fileUrl && fileType?.startsWith("image/");
  const hasAttachment = !!fileUrl;

  const handleFileClick = async () => {
    if (fileUrl) {
      try {
        await Linking.openURL(fileUrl);
      } catch (err) {
        console.warn("Failed to open URL", err);
      }
    }
  };

  return (
    <View style={[styles.row, outgoing ? styles.rowOutgoing : styles.rowIncoming]}>
      <View style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}>
        {/* Render attachment if exists */}
        {hasAttachment && (
          <View style={styles.attachmentContainer}>
            {isImage ? (
              <>
                <TouchableOpacity activeOpacity={0.8} onPress={() => setModalVisible(true)}>
                  <Image source={{ uri: fileUrl }} style={styles.imagePreview} resizeMode="cover" />
                </TouchableOpacity>

                <Modal
                  visible={modalVisible}
                  transparent={true}
                  onRequestClose={() => setModalVisible(false)}
                  animationType="fade"
                >
                  <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
                    <View style={styles.modalContent}>
                      <Image source={{ uri: fileUrl }} style={styles.fullImage} resizeMode="contain" />
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={styles.closeButton}
                        onPress={() => setModalVisible(false)}
                      >
                        <Text style={styles.closeButtonText}>✕ Schließen</Text>
                      </TouchableOpacity>
                    </View>
                  </Pressable>
                </Modal>
              </>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.fileCard, outgoing ? styles.fileCardOutgoing : styles.fileCardIncoming]}
                onPress={handleFileClick}
              >
                <Text style={styles.fileIcon}>📄</Text>
                <View style={styles.fileMeta}>
                  <Text style={[styles.fileName, outgoing ? styles.fileTextOutgoing : styles.fileTextIncoming]} numberOfLines={1}>
                    {fileName || "Anhang"}
                  </Text>
                  <Text style={[styles.fileSize, outgoing ? styles.fileSubtextOutgoing : styles.fileSubtextIncoming]}>
                    {formatBytes(fileSize)}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Message body (only if body is not empty) */}
        {body.trim().length > 0 && (
          <Text style={[styles.body, outgoing ? styles.outgoingText : styles.incomingText]}>
            {body}
          </Text>
        )}

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

  // Attachments styles
  attachmentContainer: { marginBottom: 6, marginTop: 2 },
  imagePreview: { width: 220, height: 150, borderRadius: 12 },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44, // Touch target
  },
  fileCardIncoming: {
    backgroundColor: "#E2DDD5",
    borderColor: "#C5BEB5",
  },
  fileCardOutgoing: {
    backgroundColor: "#6B8A72",
    borderColor: "#57735D",
  },
  fileIcon: { fontSize: 24, marginRight: 8 },
  fileMeta: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: "600" },
  fileSize: { fontSize: 11, marginTop: 2 },
  fileTextIncoming: { color: "#2A2720" },
  fileTextOutgoing: { color: "#FFFFFF" },
  fileSubtextIncoming: { color: "#8A8176" },
  fileSubtextOutgoing: { color: "#E2DDD5" },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  fullImage: {
    width: "100%",
    height: "80%",
  },
  closeButton: {
    marginTop: 20,
    backgroundColor: "#7D9B84",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: "center",
  },
  closeButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
  },
});
