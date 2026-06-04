import NetInfo from "@react-native-community/netinfo";
import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { decryptMessage, deriveSharedSecret, encryptMessage, importPrivateKey, importPublicKey, publicKeysMatch } from "@packages/shared";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import { Q } from "@nozbe/watermelondb";

import { ChatBubble } from "../components/ChatBubble";
import { database } from "../database";
import { pruneLocalVerification, syncVerifiedKeyToLocal } from "../sync/keyVerificationSync";

const LOCAL_PRIVATE_KEY_KEY = "familycal.e2ee.privateKeyJwk";
const DECRYPT_FAILED = "*Nachricht konnte nicht entschlüsselt werden*";

function isOnline(network: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
  // Fail-closed: only treat the device as online when connectivity is
  // explicitly confirmed. An unknown (null/undefined) reachability state must
  // NOT satisfy the "secure chats only online" invariant — require an explicit
  // `true` rather than "not false".
  return network.isConnected === true && network.isInternetReachable === true;
}

async function loadPrivateKey() {
  let serialized: string | null = null;
  if (Platform.OS === "web") {
    serialized = sessionStorage.getItem(LOCAL_PRIVATE_KEY_KEY) ?? localStorage.getItem(LOCAL_PRIVATE_KEY_KEY);
  } else {
    serialized = await SecureStore.getItemAsync(LOCAL_PRIVATE_KEY_KEY);
  }
  return serialized ? importPrivateKey(serialized) : null;
}

export default function ChatThreadScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const thread = useQuery(api.chats.getThread, threadId ? { threadId: threadId as any } : "skip");
  const isSecureThread = thread?.type === "secure_direct";
  const messages = useQuery(api.chats.listMessages, threadId && !isSecureThread ? { threadId: threadId as any } : "skip");
  const secureMessages = useQuery(api.secureChats.listSecureMessages, threadId && isSecureThread ? { threadId: threadId as any } : "skip");
  const members = useQuery(api.users.listFamilyMembers);
  const sendMessage = useMutation(api.chats.sendMessage);
  const sendSecureMessage = useMutation(api.secureChats.sendSecureMessage);
  const generateUploadUrl = useMutation(api.chats.generateUploadUrl);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [secureKey, setSecureKey] = useState<CryptoKey | null>(null);
  const [secureWarning, setSecureWarning] = useState<string | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<any[]>([]);
  const [localVerified, setLocalVerified] = useState(false);

  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; type: string; size: number } | null>(null);
  const [uploadedStorageId, setUploadedStorageId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const listRef = useRef<FlatList>(null);
  const prevCountRef = useRef(0);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const isNearBottomRef = useRef(true);
  // Serializes local key_verifications writes so a sync and a prune for the same
  // (verifier, verified) row can never interleave during rotation flapping (P5).
  const verificationOpRef = useRef<Promise<unknown>>(Promise.resolve());

  // P6: flush decrypted plaintext immediately on any thread switch — including
  // secure→secure, where secureKey/secureMessages stay truthy — so thread A's
  // plaintext can never render under thread B's header before B decrypts.
  useEffect(() => {
    setDecryptedMessages([]);
    prevCountRef.current = 0;
  }, [threadId]);

  const currentUserId = user?.id;
  const otherParticipantId = currentUserId && thread?.participantIds?.find((id: string) => id !== currentUserId);
  const otherMember = members?.find((m) => m.clerkId === otherParticipantId);
  const keyVerification = useQuery(api.secureChats.getVerificationStatus, isSecureThread && otherParticipantId ? { verifiedUserId: otherParticipantId } : "skip");
  const displayName = thread === undefined
    ? "Chat wird geladen..."
    : !thread
      ? "Chat nicht gefunden"
      : thread.type === "group"
        ? "Familienchat"
        : thread.type === "event"
          ? thread.title
          : thread.type === "secure_direct"
            ? `🔒 ${otherMember?.name ?? otherMember?.email ?? "Sicherer Chat"}`
            : (otherMember?.name ?? otherMember?.email ?? "Direktchat");

  const visibleMessages = useMemo(() => isSecureThread ? decryptedMessages : (messages ?? []), [decryptedMessages, isSecureThread, messages]);
  const loading = isSecureThread ? secureMessages === undefined || thread === undefined : messages === undefined;

  useEffect(() => {
    if (!isSecureThread || !otherMember?.publicKey) {
      setSecureKey(null);
      setSecureWarning(null);
      return;
    }
    const partnerPublicKey = otherMember.publicKey;
    let cancelled = false;
    async function prepareSecureKey() {
      const network = await NetInfo.fetch();
      if (!isOnline(network)) {
        if (!cancelled) setSecureWarning("Sichere Chats funktionieren nur online.");
        return;
      }
      const privateKey = await loadPrivateKey();
      if (!privateKey) {
        if (!cancelled) {
          setSecureWarning("E2EE muss erst eingerichtet werden.");
          Alert.alert("E2EE einrichten", "Für sichere Chats muss dein privater Schlüssel lokal vorhanden sein.", [
            { text: "Später", style: "cancel" },
            { text: "Einrichten", onPress: () => router.push("/e2e-setup" as any) },
          ]);
        }
        return;
      }
      const publicKey = await importPublicKey(partnerPublicKey);
      const sharedKey = await deriveSharedSecret(privateKey, publicKey);
      if (!cancelled) {
        setSecureKey(sharedKey);
        setSecureWarning(null);
      }
    }
    prepareSecureKey().catch((error) => {
      console.warn("Secure chat key setup failed", error);
      if (!cancelled) setSecureWarning("Sichere Verbindung konnte nicht vorbereitet werden.");
    });
    return () => { cancelled = true; };
  }, [isSecureThread, otherMember?.publicKey, router]);

  useEffect(() => {
    if (!isSecureThread || !secureMessages || !secureKey) {
      if (!isSecureThread) setDecryptedMessages([]);
      return;
    }
    let cancelled = false;
    Promise.all(secureMessages.map(async (message) => {
      try {
        const text = await decryptMessage(message.ciphertext, message.iv, secureKey);
        return { ...message, body: text };
      } catch {
        return { ...message, body: DECRYPT_FAILED };
      }
    })).then((items) => { if (!cancelled) setDecryptedMessages(items); });
    return () => { cancelled = true; };
  }, [isSecureThread, secureMessages, secureKey]);

  // P8: flush previously decrypted plaintext whenever the secure key or messages
  // become unavailable (thread switch, offline transition, partner key rotation)
  // so stale plaintext is not retained in memory or rendered after teardown.
  useEffect(() => {
    if (!secureKey || !secureMessages || !isSecureThread) {
      setDecryptedMessages([]);
    }
  }, [secureKey, secureMessages, isSecureThread]);

  // Cache a confirmed verification into the local DB so the badge survives
  // offline (6-4 AC4/AC5). getVerificationStatus already downgrades to null once
  // the verified key no longer matches the current server key. P1: when the
  // server *definitively* reports the pair as not verified (resolved null, not
  // loading/skip), prune any stale local record so the offline badge cannot keep
  // vouching for a key the server no longer matches.
  useEffect(() => {
    if (!isSecureThread || !otherParticipantId || !currentUserId) return;
    // Chain onto the previous op so sync/prune for the same row run strictly in
    // order (no interleaved writes) even when keyVerification flaps null↔record.
    const op = verificationOpRef.current
      .catch(() => {})
      .then(async () => {
        if (keyVerification) {
          await syncVerifiedKeyToLocal({ db: database as any, verification: keyVerification as any });
        } else if (keyVerification === null) {
          await pruneLocalVerification({ db: database as any, verifierId: currentUserId, verifiedUserId: otherParticipantId });
        }
      })
      .catch((error) => {
        console.warn("Key verification cache op failed", error);
      });
    verificationOpRef.current = op;
  }, [keyVerification, isSecureThread, otherParticipantId, currentUserId]);

  // Offline source of truth for the badge (6-4 AC4/AC5). A cached verification
  // only counts while its stored public key canonically matches the partner's
  // last-known server key. The member key stays cached by Convex/WatermelonDB
  // even offline, so the badge survives without connectivity. P1: when no
  // partner key is available at all we fail CLOSED (no badge) instead of
  // vouching for any cached record — a key swap must never be masked offline.
  useEffect(() => {
    if (!isSecureThread || !otherParticipantId || !currentUserId) {
      setLocalVerified(false);
      return;
    }
    const partnerPublicKey = otherMember?.publicKey;
    const subscription = database.collections
      .get("key_verifications")
      .query(Q.where("verifier_id", currentUserId), Q.where("verified_user_id", otherParticipantId))
      .observe()
      .subscribe((records: any[]) => {
        setLocalVerified(records.some((record) => publicKeysMatch(record.publicKey, partnerPublicKey)));
      });
    return () => subscription.unsubscribe();
  }, [isSecureThread, otherParticipantId, currentUserId, otherMember?.publicKey]);

  const isVerified = Boolean(keyVerification) || localVerified;

  useEffect(() => {
    if (visibleMessages) {
      if (visibleMessages.length > prevCountRef.current) {
        const lastMessage = visibleMessages[visibleMessages.length - 1];
        const isOwnMessage = currentUserId ? lastMessage?.senderId === currentUserId : false;
        const isFirstLoad = prevCountRef.current === 0;
        if (isFirstLoad || isOwnMessage || isNearBottomRef.current) {
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: !isFirstLoad }));
        }
      }
      prevCountRef.current = visibleMessages.length;
    }
  }, [visibleMessages, currentUserId]);

  useEffect(() => () => { activeXhrRef.current?.abort(); }, []);

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    isNearBottomRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
  };

  const compressImage = async (uri: string, originalWidth?: number, originalHeight?: number) => {
    const maxDim = 1920;
    const actions = [];
    if (originalWidth && originalHeight && (originalWidth > maxDim || originalHeight > maxDim)) {
      actions.push(originalWidth > originalHeight ? { resize: { width: maxDim } } : { resize: { height: maxDim } });
    }
    return await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  };

  const pickMedia = async () => {
    if (isSecureThread) {
      Alert.alert("Nicht verfügbar", "Anhänge sind in sicheren Chats noch deaktiviert, bis sie ebenfalls E2EE-verschlüsselt werden.");
      return;
    }
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Berechtigung erforderlich", "Zugriff auf die Mediathek ist erforderlich!");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsEditing: false, quality: 1 });
    if (!result.canceled && result.assets?.length) {
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
          if (!name.toLowerCase().endsWith(".jpg") && !name.toLowerCase().endsWith(".jpeg")) name = name.replace(/\.[^/.]+$/, "") + ".jpg";
          size = (await (await fetch(uri)).blob()).size;
        } catch (error) { console.warn("Failed to compress image:", error); }
      }
      if (size > 10 * 1024 * 1024) return Alert.alert("Datei zu groß", "Die maximale Dateigröße beträgt 10MB.");
      setUploadedStorageId(null);
      setSelectedFile({ uri, name, type, size });
    }
  };

  const pickDocument = async () => {
    if (isSecureThread) return Alert.alert("Nicht verfügbar", "Anhänge sind in sicheren Chats noch deaktiviert.");
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.length) {
        const asset = result.assets[0];
        const nextFile = { uri: asset.uri, name: asset.name || "document", type: asset.mimeType || "application/octet-stream", size: asset.size || 0 };
        if (nextFile.size > 10 * 1024 * 1024) return Alert.alert("Datei zu groß", "Die maximale Dateigröße beträgt 10MB.");
        setUploadedStorageId(null);
        setSelectedFile(nextFile);
      }
    } catch (error) { console.warn("Failed to pick document:", error); }
  };

  const attachMedia = () => Alert.alert("Anhang hinzufügen", "Wähle den Typ des Anhangs:", [
    { text: "Bild / Video", onPress: pickMedia },
    { text: "Dokument", onPress: pickDocument },
    { text: "Abbrechen", style: "cancel" },
  ]);

  const uploadFile = (uri: string, type: string, uploadUrl: string): Promise<string> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhrRef.current = xhr;
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => {
      activeXhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).storageId); } catch { reject(new Error("Invalid response format")); }
      } else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => { activeXhrRef.current = null; reject(new Error("XHR Error")); };
    xhr.onabort = () => { activeXhrRef.current = null; reject(new Error("XHR Aborted")); };
    fetch(uri).then((res) => res.blob()).then((blob) => xhr.send(blob)).catch((err) => { activeXhrRef.current = null; reject(err); });
  });

  const send = async () => {
    const nextBody = body.trim();
    if (!nextBody && !selectedFile) return;
    if (!threadId || isSending || isUploading) return;
    setIsSending(true);
    try {
      if (isSecureThread) {
        const network = await NetInfo.fetch();
        if (!isOnline(network)) throw new Error("Sichere Nachrichten können nur online gesendet werden.");
        if (!secureKey) throw new Error("Sichere Verbindung ist noch nicht bereit.");
        if (selectedFile) throw new Error("Anhänge sind in sicheren Chats deaktiviert.");
        const encrypted = await encryptMessage(nextBody, secureKey);
        await sendSecureMessage({ threadId: threadId as any, ciphertext: encrypted.ciphertext, iv: encrypted.iv });
      } else {
        let storageId: string | undefined = uploadedStorageId ?? undefined;
        if (selectedFile && !storageId) {
          setIsUploading(true); setUploadProgress(0);
          storageId = await uploadFile(selectedFile.uri, selectedFile.type, await generateUploadUrl());
          setUploadedStorageId(storageId); setIsUploading(false); setUploadProgress(null);
        }
        await sendMessage({ threadId: threadId as any, body: nextBody, storageId, fileName: selectedFile?.name, fileType: selectedFile?.type, fileSize: selectedFile?.size });
      }
      setBody(""); setSelectedFile(null); setUploadedStorageId(null);
    } catch (error: any) {
      console.warn("Message send failed", error);
      if (error?.data?.code === "STORAGE_LIMIT_EXCEEDED") {
        Alert.alert("Speicherlimit überschritten", "Speicherlimit der Familie überschritten!");
      } else if (error?.data?.code === "USER_LIMIT_EXCEEDED") {
        Alert.alert("Limit überschritten", "Dein persönliches Speicherlimit ist überschritten!");
      } else {
        Alert.alert("Fehler", error instanceof Error ? error.message : "Fehler beim Senden der Nachricht.");
      }
    } finally {
      setIsSending(false); setIsUploading(false); setUploadProgress(null);
    }
  };

  const handleClearPreview = () => {
    setSelectedFile(null); setUploadedStorageId(null); activeXhrRef.current?.abort();
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.select({ ios: 90, android: 0 })}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>‹ Zurück</Text></TouchableOpacity>
        <Text style={styles.heading}>{displayName}</Text>
        {isSecureThread && <Text style={styles.secureNotice}>Ende-zu-Ende verschlüsselt · nur online</Text>}
        {isSecureThread && otherParticipantId ? (
          isVerified ? (
            <View style={styles.verifiedBadge}><Text style={styles.verifiedBadgeText}>🔒 Verifiziert</Text></View>
          ) : (
            <TouchableOpacity style={styles.verifyButton} onPress={() => router.push(`/key-verification?targetUserId=${encodeURIComponent(otherParticipantId)}` as any)}>
              <Text style={styles.verifyButtonText}>🟡 Schlüssel verifizieren</Text>
            </TouchableOpacity>
          )
        ) : null}
        {secureWarning && <Text style={styles.warning}>{secureWarning}</Text>}
      </View>

      {loading ? <View style={styles.skeletonStack}><View style={styles.skeletonIncoming} /><View style={styles.skeletonOutgoing} /><View style={styles.skeletonIncoming} /></View> : (
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(item) => String(item._id)}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => <ChatBubble body={item.body} createdAt={item.createdAt} outgoing={currentUserId ? item.senderId === currentUserId : false} fileName={item.fileName} fileType={item.fileType} fileSize={item.fileSize} fileUrl={item.fileUrl} isSecure={isSecureThread} />}
          ListEmptyComponent={<Text style={styles.empty}>Noch keine Nachrichten. Schreib die erste Nachricht.</Text>}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => { if (isNearBottomRef.current) listRef.current?.scrollToEnd({ animated: true }); }}
        />
      )}

      {selectedFile && <View style={styles.previewContainer}><View style={styles.previewContent}><Text style={styles.previewText} numberOfLines={1}>{selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</Text>{isUploading && uploadProgress !== null && <Text style={styles.uploadProgressText}>Hochladen: {uploadProgress}%</Text>}</View>{!isUploading && <TouchableOpacity accessibilityRole="button" style={styles.clearPreviewButton} onPress={handleClearPreview}><Text style={styles.clearPreviewText}>✕</Text></TouchableOpacity>}</View>}

      <View style={styles.inputRow}>
        <TouchableOpacity accessibilityRole="button" style={[styles.attachButton, isSecureThread && styles.attachDisabled]} onPress={attachMedia} disabled={isSending || isUploading || isSecureThread}><Text style={styles.attachButtonText}>📎</Text></TouchableOpacity>
        <TextInput accessibilityLabel="Nachricht schreiben" style={styles.input} value={body} onChangeText={setBody} placeholder={isSecureThread ? "Sichere Nachricht schreiben …" : "Nachricht schreiben …"} placeholderTextColor="#8A8176" multiline />
        <TouchableOpacity accessibilityRole="button" style={[styles.sendButton, (((!body.trim() && !selectedFile) || isSending || isUploading || (isSecureThread && !secureKey)) && styles.sendDisabled)]} onPress={send} disabled={(!body.trim() && !selectedFile) || isSending || isUploading || (isSecureThread && !secureKey)}><Text style={styles.sendText}>Senden</Text></TouchableOpacity>
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
  secureNotice: { color: "#50603F", marginTop: 4, fontWeight: "700", fontFamily: "Atyp BL Variable" },
  warning: { color: "#8A4B3A", marginTop: 4, fontWeight: "700", fontFamily: "Atyp BL Variable" },
  verifiedBadge: { alignSelf: "flex-start", marginTop: 8, backgroundColor: "#DDE8D8", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  verifiedBadgeText: { color: "#2F6B3A", fontWeight: "800", fontFamily: "Atyp BL Variable" },
  verifyButton: { alignSelf: "flex-start", marginTop: 8, backgroundColor: "#FFF3C4", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  verifyButtonText: { color: "#765A00", fontWeight: "800", fontFamily: "Atyp BL Variable" },
  messages: { paddingVertical: 12, flexGrow: 1 },
  skeletonStack: { flex: 1, padding: 16 },
  skeletonIncoming: { width: "60%", height: 54, borderRadius: 12, backgroundColor: "#FBF9F5", borderWidth: 1, borderColor: "#E2DDD5", marginBottom: 10 },
  skeletonOutgoing: { width: "64%", height: 54, borderRadius: 12, backgroundColor: "#DDE8D8", alignSelf: "flex-end", marginBottom: 10 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24, fontFamily: "Atyp BL Variable" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E2DDD5", backgroundColor: "#FBF9F5" },
  attachButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E2DDD5" },
  attachDisabled: { opacity: 0.45 },
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
