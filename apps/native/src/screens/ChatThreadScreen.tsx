import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { ChatBubble } from "../components/ChatBubble";

export default function ChatThreadScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const messages = useQuery(api.chats.listMessages, threadId ? { threadId: threadId as any } : "skip");
  const thread = useQuery(api.chats.getThread, threadId ? { threadId: threadId as any } : "skip");
  const members = useQuery(api.users.listFamilyMembers);
  const sendMessage = useMutation(api.chats.sendMessage);
  const generateUploadUrl = useMutation(api.chats.generateUploadUrl);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const listRef = useRef<FlatList>(null);
  const prevCountRef = useRef(0);

  const currentUserId = user?.id;
  const loading = messages === undefined;

  const otherParticipantId = currentUserId && thread?.participantIds?.find((id: string) => id !== currentUserId);
  const otherMember = members?.find((m) => m.clerkId === otherParticipantId);
  const displayName = !thread
    ? "Chat wird geladen..."
    : thread.type === "group"
      ? "Familienchat"
      : thread.type === "event"
        ? thread.title
        : (otherMember?.name ?? otherMember?.email ?? "Direktchat");

  useEffect(() => {
    if (messages) {
      if (messages.length > prevCountRef.current) {
        const lastMessage = messages[messages.length - 1];
        const isOwnMessage = currentUserId ? lastMessage?.senderId === currentUserId : false;
        const isFirstLoad = prevCountRef.current === 0;

        if (isFirstLoad || isOwnMessage) {
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: isOwnMessage });
          });
        }
      }
      prevCountRef.current = messages.length;
    }
  }, [messages, currentUserId]);

  const compressImage = async (uri: string, originalWidth?: number, originalHeight?: number) => {
    const maxDim = 1920;
    const actions = [];
    if (originalWidth && originalHeight) {
      if (originalWidth > maxDim || originalHeight > maxDim) {
        if (originalWidth > originalHeight) {
          actions.push({ resize: { width: maxDim } });
        } else {
          actions.push({ resize: { height: maxDim } });
        }
      }
    } else {
      actions.push({ resize: { width: maxDim } });
    }

    return await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
  };

  const pickMedia = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      alert("Zugriff auf die Mediathek ist erforderlich!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      let uri = asset.uri;
      let name = asset.fileName || uri.split("/").pop() || "image.jpg";
      let type = asset.mimeType || "image/jpeg";
      let size = asset.fileSize || 0;

      if (type.startsWith("image/")) {
        try {
          const compressed = await compressImage(uri, asset.width, asset.height);
          uri = compressed.uri;
          type = "image/jpeg";
          if (!name.toLowerCase().endsWith(".jpg") && !name.toLowerCase().endsWith(".jpeg")) {
            name = name.split(".")[0] + ".jpg";
          }
          const response = await fetch(uri);
          const blob = await response.blob();
          size = blob.size;
        } catch (error) {
          console.warn("Failed to compress image:", error);
        }
      }

      const MAX_SIZE = 10 * 1024 * 1024;
      if (size > MAX_SIZE) {
        alert("Die Datei ist zu groß. Die maximale Dateigröße beträgt 10MB.");
        return;
      }

      setSelectedFile({ uri, name, type, size });
    }
  };

  const uploadFile = (uri: string, type: string, uploadUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Content-Type", type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response.storageId);
          } catch (e) {
            reject(new Error("Invalid response format"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("XHR Error"));
      xhr.onabort = () => reject(new Error("XHR Aborted"));

      fetch(uri)
        .then((res) => res.blob())
        .then((blob) => xhr.send(blob))
        .catch(reject);
    });
  };

  const send = async () => {
    const nextBody = body.trim();
    if (!nextBody && !selectedFile) return;
    if (!threadId || isSending || isUploading) return;

    setIsSending(true);
    let storageId: string | undefined = undefined;

    try {
      if (selectedFile) {
        setIsUploading(true);
        setUploadProgress(0);
        const uploadUrl = await generateUploadUrl();
        storageId = await uploadFile(selectedFile.uri, selectedFile.type, uploadUrl);
        setIsUploading(false);
        setUploadProgress(null);
      }

      await sendMessage({
        threadId: threadId as any,
        body: nextBody,
        storageId,
        fileName: selectedFile?.name,
        fileType: selectedFile?.type,
        fileSize: selectedFile?.size,
      });

      setBody("");
      setSelectedFile(null);
    } catch (error: any) {
      console.warn("Message send failed", error);
      if (error?.data?.code === "STORAGE_LIMIT_EXCEEDED") {
        alert("Speicherlimit der Familie überschritten!");
      } else if (error?.data?.code === "USER_LIMIT_EXCEEDED") {
        alert("Dein persönliches Speicherlimit ist überschritten!");
      } else {
        alert("Fehler beim Senden der Nachricht.");
      }
    } finally {
      setIsSending(false);
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.select({ ios: 90, android: 0 })}
    >
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>{displayName}</Text>
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
              fileName={item.fileName}
              fileType={item.fileType}
              fileSize={item.fileSize}
              fileUrl={item.fileUrl}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Nachrichten. Schreib die erste Nachricht.</Text>}
          contentContainerStyle={styles.messages}
        />
      )}

      {selectedFile && (
        <View style={styles.previewContainer}>
          <View style={styles.previewContent}>
            <Text style={styles.previewText} numberOfLines={1}>
              {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
            </Text>
            {isUploading && uploadProgress !== null && (
              <Text style={styles.uploadProgressText}>Hochladen: {uploadProgress}%</Text>
            )}
          </View>
          {!isUploading && (
            <TouchableOpacity accessibilityRole="button" style={styles.clearPreviewButton} onPress={() => setSelectedFile(null)}>
              <Text style={styles.clearPreviewText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.attachButton}
          onPress={pickMedia}
          disabled={isSending || isUploading}
        >
          <Text style={styles.attachButtonText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          accessibilityLabel="Nachricht schreiben"
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Nachricht schreiben …"
          placeholderTextColor="#8A8176"
          multiline
        />
        <TouchableOpacity accessibilityRole="button" style={[styles.sendButton, (!body.trim() && !selectedFile || isSending || isUploading) && styles.sendDisabled]} onPress={send} disabled={(!body.trim() && !selectedFile) || isSending || isUploading}>
          <Text style={styles.sendText}>Senden</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E2DDD5", backgroundColor: "#FBF9F5" },
  attachButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E2DDD5" },
  attachButtonText: { fontSize: 20, color: "#5C7C8A" },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, paddingVertical: 10, color: "#2A2720", backgroundColor: "#FFFFFF" },
  sendButton: { minWidth: 76, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  sendDisabled: { opacity: 0.55 },
  sendText: { color: "#FFFFFF", fontWeight: "700" },
  previewContainer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FBF9F5", paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "#E2DDD5" },
  previewContent: { flex: 1 },
  previewText: { color: "#2A2720", fontWeight: "600", fontSize: 14 },
  uploadProgressText: { color: "#5C7C8A", fontSize: 12, marginTop: 2 },
  clearPreviewButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#E2DDD5", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  clearPreviewText: { color: "#5C7C8A", fontSize: 14, fontWeight: "bold" },
});
