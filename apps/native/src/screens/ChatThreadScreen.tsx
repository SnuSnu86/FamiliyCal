import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";

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
  const [uploadedStorageId, setUploadedStorageId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const listRef = useRef<FlatList>(null);
  const prevCountRef = useRef(0);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const isNearBottomRef = useRef(true);

  const currentUserId = user?.id;
  const loading = messages === undefined;

  const otherParticipantId = currentUserId && thread?.participantIds?.find((id: string) => id !== currentUserId);
  const otherMember = members?.find((m) => m.clerkId === otherParticipantId);
  const displayName = thread === undefined
    ? "Chat wird geladen..."
    : !thread
      ? "Chat nicht gefunden"
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

        if (isFirstLoad || isOwnMessage || isNearBottomRef.current) {
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: !isFirstLoad });
          });
        }
      }
      prevCountRef.current = messages.length;
    }
  }, [messages, currentUserId]);

  useEffect(() => {
    return () => {
      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
      }
    };
  }, []);

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 100;
    isNearBottomRef.current =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
  };

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
      Alert.alert("Berechtigung erforderlich", "Zugriff auf die Mediathek ist erforderlich!");
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
            name = name.replace(/\.[^/.]+$/, "") + ".jpg";
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
        Alert.alert("Datei zu groß", "Die maximale Dateigröße beträgt 10MB.");
        return;
      }

      setUploadedStorageId(null);
      setSelectedFile({ uri, name, type, size });
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const uri = asset.uri;
        const name = asset.name || "document";
        const type = asset.mimeType || "application/octet-stream";
        const size = asset.size || 0;

        const MAX_SIZE = 10 * 1024 * 1024;
        if (size > MAX_SIZE) {
          Alert.alert("Datei zu groß", "Die maximale Dateigröße beträgt 10MB.");
          return;
        }

        setUploadedStorageId(null);
        setSelectedFile({ uri, name, type, size });
      }
    } catch (error) {
      console.warn("Failed to pick document:", error);
    }
  };

  const attachMedia = () => {
    Alert.alert(
      "Anhang hinzufügen",
      "Wähle den Typ des Anhangs:",
      [
        { text: "Bild / Video", onPress: pickMedia },
        { text: "Dokument", onPress: pickDocument },
        { text: "Abbrechen", style: "cancel" }
      ]
    );
  };

  const uploadFile = (uri: string, type: string, uploadUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeXhrRef.current = xhr;
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Content-Type", type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = () => {
        activeXhrRef.current = null;
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

      xhr.onerror = () => {
        activeXhrRef.current = null;
        reject(new Error("XHR Error"));
      };
      xhr.onabort = () => {
        activeXhrRef.current = null;
        reject(new Error("XHR Aborted"));
      };

      fetch(uri)
        .then((res) => res.blob())
        .then((blob) => xhr.send(blob))
        .catch((err) => {
          activeXhrRef.current = null;
          reject(err);
        });
    });
  };

  const send = async () => {
    const nextBody = body.trim();
    if (!nextBody && !selectedFile) return;
    if (!threadId || isSending || isUploading) return;

    setIsSending(true);
    let storageId: string | undefined = uploadedStorageId ?? undefined;

    try {
      if (selectedFile && !storageId) {
        setIsUploading(true);
        setUploadProgress(0);
        const uploadUrl = await generateUploadUrl();
        storageId = await uploadFile(selectedFile.uri, selectedFile.type, uploadUrl);
        setUploadedStorageId(storageId);
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
      setUploadedStorageId(null);
    } catch (error: any) {
      console.warn("Message send failed", error);
      if (error?.data?.code === "STORAGE_LIMIT_EXCEEDED") {
        Alert.alert("Speicherlimit überschritten", "Speicherlimit der Familie überschritten!");
      } else if (error?.data?.code === "USER_LIMIT_EXCEEDED") {
        Alert.alert("Limit überschritten", "Dein persönliches Speicherlimit ist überschritten!");
      } else {
        Alert.alert("Fehler", "Fehler beim Senden der Nachricht.");
      }
    } finally {
      setIsSending(false);
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleClearPreview = () => {
    setSelectedFile(null);
    setUploadedStorageId(null);
    if (activeXhrRef.current) {
      activeXhrRef.current.abort();
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
          onScroll={handleScroll}
          scrollEventThrottle={16}
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
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
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
            <TouchableOpacity accessibilityRole="button" style={styles.clearPreviewButton} onPress={handleClearPreview}>
              <Text style={styles.clearPreviewText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.attachButton}
          onPress={attachMedia}
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
  backText: { color: "#5C7C8A", fontWeight: "700", fontFamily: "Atyp BL Variable" },
  heading: { color: "#2A2720", fontSize: 22, fontWeight: "700", fontFamily: "Atyp BL Variable" },
  messages: { paddingVertical: 12, flexGrow: 1 },
  skeletonStack: { flex: 1, padding: 16 },
  skeletonIncoming: { width: "60%", height: 54, borderRadius: 12, backgroundColor: "#FBF9F5", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 10 },
  skeletonOutgoing: { width: "64%", height: 54, borderRadius: 12, backgroundColor: "#DDE8D8", alignSelf: "flex-end", marginBottom: 10 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24, fontFamily: "Atyp BL Variable" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E2DDD5", backgroundColor: "#FBF9F5" },
  attachButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E2DDD5" },
  attachButtonText: { fontSize: 20, color: "#5C7C8A" },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, paddingVertical: 10, color: "#2A2720", backgroundColor: "#FFFFFF", fontFamily: "Atyp BL Variable" },
  sendButton: { minWidth: 76, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  sendDisabled: { opacity: 0.55 },
  sendText: { color: "#FFFFFF", fontWeight: "700", fontFamily: "Atyp BL Variable" },
  previewContainer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FBF9F5", paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "#E2DDD5" },
  previewContent: { flex: 1 },
  previewText: { color: "#2A2720", fontWeight: "600", fontSize: 14, fontFamily: "Atyp BL Variable" },
  uploadProgressText: { color: "#5C7C8A", fontSize: 12, marginTop: 2, fontFamily: "Atyp BL Variable" },
  clearPreviewButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E2DDD5", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  clearPreviewText: { color: "#5C7C8A", fontSize: 14, fontWeight: "bold", fontFamily: "Atyp BL Variable" },
});
