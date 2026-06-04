import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";

import { ChatBubble } from "../ChatBubble";

type Props = {
  calendarEventId?: string | null;
};

export function EventComments({ calendarEventId }: Props) {
  const { user } = useUser();
  const messages = useQuery(api.chats.listEventMessages, calendarEventId ? { calendarEventId: calendarEventId as any } : "skip");
  const ensureEventThread = useMutation(api.chats.ensureEventThread);
  const sendEventComment = useMutation(api.chats.sendEventComment);
  const generateUploadUrl = useMutation(api.chats.generateUploadUrl);
  
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

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

  useEffect(() => {
    if (!calendarEventId) return;
    ensureEventThread({ calendarEventId: calendarEventId as any }).catch((error) => {
      console.warn("Event comment thread setup failed", error);
      setErrorText("Kommentare konnten gerade nicht vorbereitet werden.");
    });
  }, [calendarEventId, ensureEventThread]);

  useEffect(() => {
    if (messages) {
      if (messages.length > prevCountRef.current) {
        const lastMessage = messages[messages.length - 1];
        const isOwnMessage = user?.id ? lastMessage?.senderId === user.id : false;
        const isFirstLoad = prevCountRef.current === 0;

        if (isFirstLoad || isOwnMessage || isNearBottomRef.current) {
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: !isFirstLoad });
          });
        }
      }
      prevCountRef.current = messages.length;
    }
  }, [messages, user?.id]);

  useEffect(() => {
    return () => {
      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
      }
    };
  }, []);

  if (!calendarEventId) {
    return <Text style={styles.syncHint}>Kommentare sind verfügbar, sobald der Termin synchronisiert ist.</Text>;
  }

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
    if (isSending || isUploading) return;

    setIsSending(true);
    setErrorText(null);
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

      await sendEventComment({
        calendarEventId: calendarEventId as any,
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
      console.warn("Event comment send failed", error);
      if (error?.data?.code === "STORAGE_LIMIT_EXCEEDED") {
        setErrorText("Speicherlimit der Familie überschritten!");
      } else if (error?.data?.code === "USER_LIMIT_EXCEEDED") {
        setErrorText("Dein persönliches Speicherlimit ist überschritten!");
      } else {
        setErrorText("Kommentar konnte nicht gesendet werden. Bitte versuche es gleich noch einmal.");
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
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <ChatBubble
              body={item.body}
              createdAt={item.createdAt}
              outgoing={user?.id ? item.senderId === user.id : false}
              fileName={item.fileName}
              fileType={item.fileType}
              fileSize={item.fileSize}
              fileUrl={item.fileUrl}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Kommentare zu diesem Termin.</Text>}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
        />
      )}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

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
          accessibilityLabel="Kommentar schreiben"
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Kommentar schreiben …"
          placeholderTextColor="#8A8176"
          multiline
        />
        <TouchableOpacity accessibilityRole="button" style={[styles.sendButton, (!body.trim() && !selectedFile || isSending || isUploading) && styles.sendDisabled]} onPress={send} disabled={(!body.trim() && !selectedFile) || isSending || isUploading}>
          <Text style={styles.sendText}>Senden</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12, minHeight: 220, maxHeight: 360, borderTopWidth: 1, borderTopColor: "#E2DDD5", paddingTop: 12 },
  title: { color: "#2A2720", fontSize: 16, fontWeight: "700", marginBottom: 8, fontFamily: "Atyp BL Variable" },
  syncHint: { color: "#5C7C8A", marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#F5F2EB", fontFamily: "Atyp BL Variable" },
  messages: { paddingVertical: 4, flexGrow: 1 },
  skeletonStack: { minHeight: 96, paddingVertical: 4 },
  skeletonIncoming: { width: "68%", height: 48, borderRadius: 12, backgroundColor: "#F5F2EB", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 8 },
  skeletonOutgoing: { width: "62%", height: 48, borderRadius: 12, backgroundColor: "#DDE8D8", alignSelf: "flex-end", marginBottom: 8 },
  empty: { color: "#2A2720", textAlign: "center", padding: 16, fontFamily: "Atyp BL Variable" },
  error: { color: "#8A3B2F", marginTop: 4, fontFamily: "Atyp BL Variable" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 96, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, paddingVertical: 10, color: "#2A2720", backgroundColor: "#FFFFFF", fontFamily: "Atyp BL Variable" },
  sendButton: { minWidth: 76, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  sendDisabled: { opacity: 0.55 },
  sendText: { color: "#FFFFFF", fontWeight: "700", fontFamily: "Atyp BL Variable" },
  attachButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E2DDD5" },
  attachButtonText: { fontSize: 20, color: "#5C7C8A" },
  previewContainer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FBF9F5", paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "#E2DDD5", marginTop: 8 },
  previewContent: { flex: 1 },
  previewText: { color: "#2A2720", fontWeight: "600", fontSize: 14, fontFamily: "Atyp BL Variable" },
  uploadProgressText: { color: "#5C7C8A", fontSize: 12, marginTop: 2, fontFamily: "Atyp BL Variable" },
  clearPreviewButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E2DDD5", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  clearPreviewText: { color: "#5C7C8A", fontSize: 14, fontWeight: "bold", fontFamily: "Atyp BL Variable" },
});
