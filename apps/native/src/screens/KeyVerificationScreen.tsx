import { useUser } from "@clerk/expo";
import { api } from "@packages/backend/convex/_generated/api";
import { computeKeyFingerprint, derivePublicKeyFromPrivate, publicKeysMatch } from "@packages/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { database } from "../database";
import { syncVerifiedKeyToLocal } from "../sync/keyVerificationSync";

const LOCAL_PRIVATE_KEY_KEY = "familycal.e2ee.privateKeyJwk";
const MAX_PUBLIC_KEY_LENGTH = 2048;
const MAX_QR_PAYLOAD_LENGTH = 4096;
const MAX_USER_ID_LENGTH = 256;
const ALLOWED_PAYLOAD_KEYS = ["version", "userId", "publicKey", "fingerprint"];

type VerificationPayload = { version: string; userId: string; publicKey: string; fingerprint: string };

function formatFingerprint(fingerprint?: string) {
  return (fingerprint ?? "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

async function loadLocalPrivateKeyString(): Promise<string | null> {
  if (Platform.OS === "web") {
    return sessionStorage.getItem(LOCAL_PRIVATE_KEY_KEY) ?? localStorage.getItem(LOCAL_PRIVATE_KEY_KEY);
  }
  return SecureStore.getItemAsync(LOCAL_PRIVATE_KEY_KEY);
}

function parsePayload(data: string): VerificationPayload {
  // Bound the raw payload before JSON.parse so an oversized/maliciously nested
  // QR cannot block the JS thread or spike memory before validation runs.
  if (typeof data !== "string" || data.length === 0 || data.length > MAX_QR_PAYLOAD_LENGTH) {
    throw new Error("Ungültiger QR-Code: Inhalt hat ein unerwartetes Format.");
  }
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("Ungültiger QR-Code: Inhalt konnte nicht gelesen werden.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ungültiger QR-Code");
  }
  // Reject unexpected fields so a crafted QR cannot smuggle extra data past the
  // validator into downstream consumers.
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_PAYLOAD_KEYS.includes(key)) {
      throw new Error("Ungültiger QR-Code: Unerwartete Felder im Inhalt.");
    }
  }
  if (parsed.version !== "1.0" || typeof parsed.userId !== "string" || typeof parsed.publicKey !== "string" || typeof parsed.fingerprint !== "string") {
    throw new Error("Ungültiger QR-Code");
  }
  if (parsed.userId.length === 0 || parsed.userId.length > MAX_USER_ID_LENGTH) {
    throw new Error("Ungültiger QR-Code: Nutzerkennung hat ein unerwartetes Format.");
  }
  if (parsed.publicKey.length === 0 || parsed.publicKey.length > MAX_PUBLIC_KEY_LENGTH || parsed.fingerprint.length === 0 || parsed.fingerprint.length > 256) {
    throw new Error("Ungültiger QR-Code: Schlüsseldaten haben ein unerwartetes Format.");
  }
  return parsed;
}

export default function KeyVerificationScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { targetUserId } = useLocalSearchParams<{ targetUserId?: string }>();
  const [activeTab, setActiveTab] = useState<"mine" | "scan">("mine");
  const [permission, requestPermission] = useCameraPermissions();
  const [isHandlingScan, setIsHandlingScan] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const members = useQuery(api.users.listFamilyMembers);
  const currentUser = members?.find((member) => member.clerkId === user?.id);
  const targetUser = members?.find((member) => member.clerkId === targetUserId);
  const verifyParticipantKey = useMutation(api.secureChats.verifyParticipantKey);

  // P0a: attest the *device-local* public key (derived from the locally stored
  // private key), NOT the server-provided currentUser.publicKey. Comparing the
  // scanned key only against the server copy is tautological and cannot detect a
  // server-side key swap — the exact MitM this story must prevent.
  const [localKeyState, setLocalKeyState] = useState<"loading" | "ready" | "missing">("loading");
  const [localPublicKey, setLocalPublicKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const serialized = await loadLocalPrivateKeyString();
        if (!serialized) {
          if (!cancelled) { setLocalPublicKey(null); setLocalKeyState("missing"); }
          return;
        }
        const publicKey = await derivePublicKeyFromPrivate(serialized);
        if (!cancelled) { setLocalPublicKey(publicKey); setLocalKeyState("ready"); }
      } catch (error) {
        console.warn("Local public key derivation failed", error);
        if (!cancelled) { setLocalPublicKey(null); setLocalKeyState("missing"); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ownFingerprint = useMemo(() => localPublicKey ? computeKeyFingerprint(localPublicKey) : Promise.resolve(""), [localPublicKey]);
  const [resolvedOwnFingerprint, setResolvedOwnFingerprint] = useState("");
  // P9: surface a fingerprint-derivation failure instead of swallowing it to ""
  // (which would otherwise leave the QR area on an endless spinner with no hint).
  const [ownFingerprintError, setOwnFingerprintError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setOwnFingerprintError(false);
    ownFingerprint
      .then((value) => { if (!cancelled) setResolvedOwnFingerprint(value); })
      .catch((error) => {
        console.warn("Own fingerprint derivation failed", error);
        if (!cancelled) { setResolvedOwnFingerprint(""); setOwnFingerprintError(true); }
      });
    return () => { cancelled = true; };
  }, [ownFingerprint]);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!result) return;
    overlayOpacity.setValue(0);
    Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [result, overlayOpacity]);

  // P6: re-check camera permission when the app returns to the foreground on the
  // scan tab, recovering from a permission revoked in OS settings mid-session
  // instead of leaving a frozen, non-functional camera.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && activeTab === "scan" && permission && !permission.granted && permission.canAskAgain) {
        requestPermission().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [activeTab, permission, requestPermission]);

  const qrValue = localPublicKey && user?.id && resolvedOwnFingerprint ? JSON.stringify({
    version: "1.0",
    userId: user.id,
    publicKey: localPublicKey,
    fingerprint: resolvedOwnFingerprint,
  }) : "";

  const handleScanned = async ({ data }: { data: string }) => {
    if (isHandlingScan) return;
    if (!targetUserId) {
      setResult({ ok: false, message: "Kein Chat-Partner ausgewählt. Öffne die Verifizierung aus einem sicheren Chat." });
      return;
    }
    if (members === undefined) {
      setResult({ ok: false, message: "Familienmitglieder werden noch geladen. Bitte versuche es gleich erneut." });
      return;
    }
    if (!targetUser?.publicKey) {
      setResult({ ok: false, message: "Dein Chat-Partner hat E2EE noch nicht eingerichtet – es gibt noch keinen Schlüssel zum Verifizieren." });
      return;
    }
    setIsHandlingScan(true);
    try {
      const payload = parsePayload(data);
      if (payload.userId !== targetUserId) throw new Error("Der QR-Code gehört nicht zum ausgewählten Chat-Partner.");
      // Compare by canonical key material, not raw JWK string — two honest
      // devices/platforms may serialize the same key differently. publicKeysMatch
      // fails closed on unparseable keys, so a malformed scanned key still trips
      // the MitM warning rather than silently passing.
      if (!publicKeysMatch(payload.publicKey, targetUser.publicKey)) throw new Error("Sicherheitswarnung: Der gescannte Schlüssel stimmt nicht mit dem vom Server gelieferten Schlüssel überein. Möglicher Man-in-the-Middle-Angriff.");
      // Fingerprint must bind to the *scanned* key, not the server copy.
      const computedFingerprint = await computeKeyFingerprint(payload.publicKey);
      if (computedFingerprint !== payload.fingerprint) throw new Error("Sicherheitswarnung: Der Fingerprint stimmt nicht mit dem gescannten Schlüssel überein.");
      const record = await verifyParticipantKey({ verifiedUserId: targetUserId, publicKey: payload.publicKey, fingerprint: payload.fingerprint });
      await syncVerifiedKeyToLocal({ db: database as any, verification: record as any }).catch((error) => console.warn("Key verification cache failed", error));
      setResult({ ok: true, message: "Schlüssel erfolgreich verifiziert und gespeichert." });
    } catch (error: any) {
      setResult({ ok: false, message: error?.message ?? "Sicherheitswarnung: QR-Code konnte nicht verifiziert werden." });
    } finally {
      setIsHandlingScan(false);
    }
  };

  const renderMine = () => (
    <View style={styles.card}>
      {currentUser?.imageUrl ? <Image source={{ uri: currentUser.imageUrl }} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarText}>{(currentUser?.name ?? "?").slice(0, 1)}</Text></View>}
      <Text style={styles.name}>{currentUser?.name ?? currentUser?.email ?? "Mein Profil"}</Text>
      {qrValue ? (
        <QRCode value={qrValue} size={220} />
      ) : localKeyState === "missing" ? (
        <Text style={styles.info}>Du hast E2EE noch nicht eingerichtet. Richte deinen Schlüssel ein, um einen QR-Code anzuzeigen.</Text>
      ) : ownFingerprintError ? (
        <Text style={styles.info}>Dein Schlüssel-Fingerprint konnte nicht berechnet werden. Bitte öffne den Bildschirm erneut.</Text>
      ) : (
        <ActivityIndicator color="#0D87E1" />
      )}
      <Text style={styles.fingerprint}>{formatFingerprint(resolvedOwnFingerprint)}</Text>
    </View>
  );

  const renderScan = () => {
    if (!targetUserId) return <Text style={styles.info}>Öffne die Verifizierung aus einem sicheren Chat, damit der Zielnutzer bekannt ist.</Text>;
    if (members === undefined) return <View style={styles.card}><ActivityIndicator color="#0D87E1" /><Text style={styles.info}>Familienmitglieder werden geladen …</Text></View>;
    if (!targetUser?.publicKey) return <View style={styles.card}><Text style={styles.info}>Dein Chat-Partner hat E2EE noch nicht eingerichtet. Sobald ein Schlüssel vorhanden ist, kannst du ihn hier verifizieren.</Text></View>;
    if (!permission?.granted) return <View style={styles.card}><Text style={styles.info}>{permission && !permission.canAskAgain ? "Kamerazugriff wurde abgelehnt. Bitte erlaube den Zugriff in den Systemeinstellungen, um QR-Codes zu scannen." : "Kamerazugriff wird benötigt, um Schlüssel-QR-Codes zu scannen."}</Text><TouchableOpacity style={styles.primaryButton} onPress={requestPermission}><Text style={styles.primaryButtonText}>Kamera erlauben</Text></TouchableOpacity></View>;
    return <View style={styles.scanner}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={isHandlingScan || result ? undefined : handleScanned} /><View style={styles.frame} /></View>;
  };

  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Zurück</Text></TouchableOpacity><Text style={styles.title}>Schlüssel verifizieren</Text></View>
    <View style={styles.tabs}><TouchableOpacity style={[styles.tab, activeTab === "mine" && styles.activeTab]} onPress={() => setActiveTab("mine")}><Text>Mein QR-Code</Text></TouchableOpacity><TouchableOpacity style={[styles.tab, activeTab === "scan" && styles.activeTab]} onPress={() => setActiveTab("scan")}><Text>Kamera scannen</Text></TouchableOpacity></View>
    {activeTab === "mine" ? renderMine() : renderScan()}
    {result ? (
      <Animated.View style={[styles.overlay, result.ok ? styles.success : styles.error, { opacity: overlayOpacity }]}>
        <Text style={styles.overlayIcon}>{result.ok ? "✓" : "!"}</Text>
        <Text style={styles.overlayText}>{result.message}</Text>
        {activeTab === "scan" ? (
          <TouchableOpacity style={styles.overlayButton} onPress={() => setResult(null)}>
            <Text style={styles.overlayButtonText}>Erneut scannen</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    ) : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB", padding: 20, gap: 18 },
  header: { gap: 8, paddingTop: 12 },
  back: { color: "#0D87E1", fontWeight: "700" },
  title: { fontSize: 26, fontWeight: "800", color: "#2E2823" },
  tabs: { flexDirection: "row", backgroundColor: "#EDE8DF", borderRadius: 14, padding: 4 },
  tab: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12 },
  activeTab: { backgroundColor: "#FFFFFF" },
  card: { alignItems: "center", justifyContent: "center", gap: 18, backgroundColor: "#FFFFFF", borderRadius: 22, padding: 24, borderWidth: 1, borderColor: "#E2DDD5" },
  avatar: { width: 76, height: 76, borderRadius: 38 },
  avatarPlaceholder: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#0D87E1", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontSize: 28, fontWeight: "800" },
  name: { fontSize: 18, fontWeight: "800", color: "#2E2823" },
  fingerprint: { fontFamily: "monospace", textAlign: "center", color: "#4B4540", lineHeight: 22 },
  info: { color: "#6F675E", textAlign: "center", lineHeight: 22 },
  primaryButton: { backgroundColor: "#0D87E1", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  primaryButtonText: { color: "white", fontWeight: "800" },
  scanner: { flex: 1, overflow: "hidden", borderRadius: 22, backgroundColor: "#111" },
  frame: { alignSelf: "center", marginTop: 120, width: 240, height: 240, borderColor: "#F6C85F", borderWidth: 3, borderRadius: 24 },
  overlay: { position: "absolute", left: 20, right: 20, bottom: 28, borderRadius: 18, padding: 18, alignItems: "center", gap: 8 },
  success: { backgroundColor: "#1B8A4B" },
  error: { backgroundColor: "#C62828" },
  overlayIcon: { color: "white", fontSize: 36, fontWeight: "900" },
  overlayText: { color: "white", fontWeight: "800", textAlign: "center" },
  overlayButton: { marginTop: 6, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 },
  overlayButtonText: { color: "white", fontWeight: "800" },
});
