import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useFamilyId } from "../hooks/useFamilyId";
import { useUser } from "@clerk/expo";
import { useRouter } from "expo-router";

type Role = "ROLE-002" | "ROLE-003" | "ROLE-004" | "ROLE-005" | "ROLE-006";

const roles: Role[] = ["ROLE-002", "ROLE-003", "ROLE-004", "ROLE-005", "ROLE-006"];

// A child's sub-quota can never sensibly exceed the 2 GB family limit.
const MAX_CHILD_QUOTA_MB = 2 * 1024;

const roleLabels: Record<string, string> = {
  "ROLE-001": "Familieninhaber",
  "ROLE-002": "Elternteil",
  "ROLE-003": "Erwachsenes Mitglied",
  "ROLE-004": "Kind",
  "ROLE-005": "Caregiver",
  "ROLE-006": "Virtuelles Mitglied",
};

export default function FamilySettingsScreen() {
  const familyId = useFamilyId();
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const currentUser = useQuery(api.users.getCurrentUser);
  const members = useQuery(api.users.listFamilyMembers);
  const invitations = useQuery(api.invitations.listInvitations);
  const canManageCaregiverPins =
    (currentUser?.role === "ROLE-001" || currentUser?.role === "ROLE-002") && !!currentUser?.familyId;
  const activeCaregiverPin = useQuery(api.caregiverPins.getActivePin, canManageCaregiverPins ? {} : "skip");
  const generateCaregiverPin = useMutation(api.caregiverPins.generatePin);
  const createInvitation = useMutation(api.invitations.createInvitation);
  const cancelInvitation = useMutation(api.invitations.cancelInvitation);
  const updateUserStorageLimit = useMutation(api.memos.updateUserStorageLimit);
  const storageStatus = useQuery(api.memos.getStorageStatus, familyId ? { familyId: familyId as any } : "skip");
  const [role, setRole] = useState<Role>("ROLE-004");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [storageLimitByUserId, setStorageLimitByUserId] = useState<Record<string, string>>({});
  const [savingLimitByUserId, setSavingLimitByUserId] = useState<Record<string, boolean>>({});
  const [remainingPinMs, setRemainingPinMs] = useState(0);
  const [isGeneratingPin, setIsGeneratingPin] = useState(false);
  const baseUrl = useMemo(() => process.env.EXPO_PUBLIC_WEB_URL ?? "https://familycal.app", []);

  const isLoading = currentUser === undefined || members === undefined || invitations === undefined;

  useEffect(() => {
    if (!activeCaregiverPin?.expiresAt) {
      setRemainingPinMs(0);
      return;
    }

    let interval: ReturnType<typeof setInterval> | undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, activeCaregiverPin.expiresAt - Date.now());
      setRemainingPinMs(remaining);
      // Bei Ablauf das Interval stoppen – sonst feuert es bis zum Unmount jede Sekunde unnötig weiter.
      if (remaining <= 0 && interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    updateRemaining();
    interval = setInterval(updateRemaining, 1000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCaregiverPin?.expiresAt]);

  async function copy(value: string) {
    await Clipboard.setStringAsync(value);
    Alert.alert("Kopiert", "Einladungslink wurde kopiert.");
  }

  async function create() {
    try {
      const result = await createInvitation({ role, email: email.trim() || undefined });
      setLink(`${baseUrl}/invite?token=${result.token}`);
    } catch (error) {
      Alert.alert("Fehler", error instanceof Error ? error.message : "Einladung konnte nicht erstellt werden.");
    }
  }

  async function generatePin() {
    setIsGeneratingPin(true);
    try {
      await generateCaregiverPin({});
    } catch (error) {
      Alert.alert("Fehler", error instanceof Error ? error.message : "PIN konnte nicht generiert werden.");
    } finally {
      setIsGeneratingPin(false);
    }
  }

  function formatPin(pin: string) {
    return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
  }

  function formatRemaining(ms: number) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  async function handleCancel(token: string) {
    try {
      await cancelInvitation({ token });
      Alert.alert("Erfolgreich", "Einladung wurde abgebrochen.");
    } catch (error) {
      Alert.alert("Fehler", error instanceof Error ? error.message : "Einladung konnte nicht abgebrochen werden.");
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#7F936B" />
      </View>
    );
  }

  const quota = storageStatus && typeof storageStatus.storageQuota === "number" ? storageStatus.storageQuota : 0;
  const used = storageStatus && typeof storageStatus.storageUsed === "number" ? storageStatus.storageUsed : 0;
  const percent = quota > 0 ? used / quota : 0;
  const storageLoading = !!familyId && storageStatus === undefined;
  const currentMember = members.find((member: any) => member.clerkId === clerkUser?.id);
  const canManageQuotas = currentMember?.role === "ROLE-001" || currentMember?.role === "ROLE-002";

  function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  async function saveChildQuota(member: any) {
    if (!familyId) return;
    const storedMb = member.storageLimit !== undefined && member.storageLimit !== null
      ? Math.round(member.storageLimit / 1048576)
      : undefined;
    const raw = storageLimitByUserId[member._id] !== undefined
      ? storageLimitByUserId[member._id]
      : (storedMb !== undefined ? String(storedMb) : "");
    const clean = raw.trim();
    const mb = clean === "" ? undefined : Number(clean);

    if (clean !== "" && (!Number.isFinite(mb) || Number(mb) < 0)) {
      Alert.alert("Ungültige Quota", "Bitte gib eine positive Zahl in MB ein oder lasse das Feld leer.");
      return;
    }
    if (mb !== undefined && Number(mb) > MAX_CHILD_QUOTA_MB) {
      Alert.alert("Ungültige Quota", `Die Unter-Quota darf höchstens ${MAX_CHILD_QUOTA_MB} MB (2 GB) betragen.`);
      return;
    }

    setSavingLimitByUserId((prev) => ({ ...prev, [member._id]: true }));
    try {
      // Avoid a lossy MB round-trip: when the entered value equals the rounded
      // stored value, keep the exact stored bytes instead of re-flooring them.
      const bytes = mb === undefined
        ? undefined
        : (mb === storedMb && member.storageLimit !== undefined && member.storageLimit !== null
          ? member.storageLimit
          : Math.floor(Number(mb) * 1024 * 1024));
      const result: any = await updateUserStorageLimit({ familyId: familyId as any, userId: member._id, storageLimit: bytes });
      setStorageLimitByUserId((prev) => ({ ...prev, [member._id]: clean }));
      if (bytes !== undefined && result && typeof result.storageUsed === "number" && result.storageUsed > bytes) {
        Alert.alert(
          "Quota gespeichert – Achtung",
          `Das Kind nutzt bereits ${formatBytes(result.storageUsed)} und liegt damit über dem neuen Limit von ${formatBytes(bytes)}. Neue Uploads werden blockiert, bis wieder Platz frei ist.`,
        );
      } else {
        Alert.alert("Gespeichert", clean ? "Unter-Quota wurde aktualisiert." : "Unter-Quota wurde entfernt.");
      }
    } catch (error) {
      Alert.alert("Fehler", error instanceof Error ? error.message : "Unter-Quota konnte nicht gespeichert werden.");
    } finally {
      setSavingLimitByUserId((prev) => ({ ...prev, [member._id]: false }));
    }
  }

  return (
    <FlatList
      data={invitations}
      keyExtractor={(item: any) => item._id}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <View>
          <Text style={styles.kicker}>FamilyCal</Text>
          <Text style={styles.title}>Familieneinstellungen</Text>

          <View style={styles.storagePanel}>
            <View style={styles.storageHeader}>
              <Text style={styles.heading}>Familienspeicher</Text>
              <Text style={styles.storagePercent}>{storageLoading ? "—" : `${Math.round(percent * 100)}%`}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${storageLoading ? 0 : Math.min(100, Math.round(percent * 100))}%` }]} />
            </View>
            <Text style={styles.muted}>
              {storageLoading ? "Speicher wird geladen…" : `${formatBytes(used)} von ${formatBytes(quota)} belegt`}
            </Text>
          </View>

          {canManageQuotas && percent >= 0.9 ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                Familien-Speicher ist zu {Math.round(percent * 100)}% belegt ({formatBytes(used)} von {formatBytes(quota)}).
                {percent >= 1 ? " Foto- und Dokumenten-Uploads sind blockiert; Sprachtranskription bleibt möglich." : " Bitte räume Alben auf oder prüfe Unter-Quotas."}
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.securityHeader}>
              <View>
                <Text style={styles.heading}>Sicherheit & Verschlüsselung (E2EE)</Text>
                <Text style={styles.muted}>Privater Schlüssel für Ende-zu-Ende-Verschlüsselung</Text>
              </View>
              <View style={styles.statusPill}>
                <View style={[styles.statusDot, currentUser?.publicKey ? styles.statusActive : styles.statusInactive]} />
                <Text style={styles.statusText}>{currentUser?.publicKey ? "Aktiv" : "Inaktiv"}</Text>
              </View>
            </View>
            {currentUser?.publicKey ? (
              <Text style={styles.securityCopy}>E2EE ist eingerichtet. Dein privater Schlüssel bleibt lokal auf deinem Gerät.</Text>
            ) : (
              <TouchableOpacity style={[styles.primaryButton, styles.securityButton]} onPress={() => router.push("/e2e-setup" as any)}>
                <Text style={styles.primaryText}>Verschlüsselung einrichten</Text>
              </TouchableOpacity>
            )}
          </View>

          {canManageCaregiverPins ? (
            <View style={styles.card}>
              <Text style={styles.heading}>Caregiver-Zugang (PIN)</Text>
              {activeCaregiverPin && remainingPinMs > 0 ? (
                <View style={styles.pinPanel}>
                  <Text style={styles.pinValue} accessibilityLabel={`Aktiver Caregiver PIN ${activeCaregiverPin.pin}`}>
                    {formatPin(activeCaregiverPin.pin)}
                  </Text>
                  <Text style={styles.pinCountdown} accessibilityLabel={`Gültig für ${formatRemaining(remainingPinMs)} Minuten`}>
                    Gültig für: {formatRemaining(remainingPinMs)} Minuten
                  </Text>
                </View>
              ) : (
                <Text style={styles.muted}>Kein aktiver PIN vorhanden. Generiere einen neuen PIN.</Text>
              )}
              <TouchableOpacity
                style={[styles.primaryButton, styles.pinButton, isGeneratingPin && styles.disabledButton]}
                disabled={isGeneratingPin}
                onPress={generatePin}
              >
                {isGeneratingPin ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.primaryText}>Einmal-PIN generieren</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
          
          <View style={styles.card}>
            <Text style={styles.heading}>Einladung erstellen</Text>
            <View style={styles.roleGrid}>
              {roles.map((item) => (
                <TouchableOpacity 
                  key={item} 
                  style={[styles.roleButton, role === item && styles.roleButtonActive]} 
                  onPress={() => setRole(item)}
                >
                  <Text style={[styles.roleText, role === item && styles.roleTextActive]}>
                    {roleLabels[item] || item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput 
              value={email} 
              onChangeText={setEmail} 
              placeholder="E-Mail optional" 
              style={styles.input} 
              autoCapitalize="none" 
            />
            <TouchableOpacity style={styles.primaryButton} onPress={create}>
              <Text style={styles.primaryText}>Einladungslink generieren</Text>
            </TouchableOpacity>
            {link ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => copy(link)}>
                <Text style={styles.secondaryText}>Generierten Link kopieren</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Mitglieder</Text>
            {members.map((member: any) => (
              <View key={member._id} style={{ marginBottom: 10 }}>
                <Text style={styles.row}>
                  {member.name || member.email} · {roleLabels[member.role] || member.role}
                </Text>
                {familyId && canManageQuotas && member.role === "ROLE-004" ? (
                  <View style={styles.quotaRow}>
                    <TextInput
                      value={
                        storageLimitByUserId[member._id] ??
                        (member.storageLimit !== undefined && member.storageLimit !== null
                          ? String(Math.round(member.storageLimit / 1048576))
                          : "")
                      }
                      onChangeText={(value) => setStorageLimitByUserId((prev) => ({ ...prev, [member._id]: value }))}
                      placeholder="Unter-Quota (MB)"
                      keyboardType="numeric"
                      style={[styles.input, styles.quotaInput]}
                    />
                    <TouchableOpacity
                      style={[styles.quotaButton, savingLimitByUserId[member._id] && styles.disabledButton]}
                      disabled={savingLimitByUserId[member._id]}
                      onPress={() => saveChildQuota(member)}
                    >
                      <Text style={styles.quotaButtonText}>{savingLimitByUserId[member._id] ? "..." : "Speichern"}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          
          <Text style={styles.heading}>Ausstehende Einladungen</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.muted}>Keine offenen Einladungen.</Text>
      }
      renderItem={({ item }: any) => (
        <View style={styles.invitationRow}>
          <View style={styles.invitationInfo}>
            <Text style={styles.row}>
              {item.email || "Einladungslink (ohne E-Mail)"}
            </Text>
            <Text style={styles.muted}>
              Rolle: {roleLabels[item.role] || item.role}
            </Text>
          </View>
          <View style={styles.actionGroup}>
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={() => copy(`${baseUrl}/invite?token=${item.token}`)}
            >
              <Text style={styles.link}>Kopieren</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={() => handleCancel(item.token)}
            >
              <Text style={styles.danger}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#F5F2EB", padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  kicker: { color: "#6F675E", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: "#2D2D2D", fontSize: 28, fontWeight: "700", marginBottom: 18 },
  warningBanner: { backgroundColor: "#FFF3CD", borderColor: "#FFDA6A", borderWidth: 1, padding: 12, borderRadius: 12, marginBottom: 14 },
  warningText: { color: "#664D03", fontWeight: "700" },
  storagePanel: { backgroundColor: "#FBF9F5", borderRadius: 8, padding: 14, marginBottom: 14, borderColor: "#D5D0C8", borderWidth: 1 },
  storageHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  storagePercent: { color: "#2D2D2D", fontSize: 18, fontWeight: "800" },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: "#E2DDD5", overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", backgroundColor: "#50603F" },
  card: { backgroundColor: "#FBF9F5", borderRadius: 12, padding: 16, marginBottom: 14, borderColor: "#E2DDD5", borderWidth: 1 },
  securityHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  statusPill: { flexDirection: "row", alignItems: "center", backgroundColor: "white", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 34 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  statusActive: { backgroundColor: "#2E7D32" },
  statusInactive: { backgroundColor: "#A87328" },
  statusText: { color: "#2D2D2D", fontWeight: "800" },
  securityCopy: { color: "#50603F", fontWeight: "700", marginTop: 12 },
  securityButton: { marginTop: 14 },
  heading: { fontSize: 18, fontWeight: "700", color: "#2D2D2D", marginBottom: 10, marginTop: 10 },
  pinPanel: { alignItems: "center", backgroundColor: "white", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  pinValue: { color: "#2A2720", fontSize: 32, fontWeight: "800", letterSpacing: 0, textAlign: "center" },
  pinCountdown: { color: "#706B60", marginTop: 6, fontWeight: "600" },
  pinButton: { marginTop: 12 },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  roleButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, justifyContent: "center", backgroundColor: "white" },
  roleButtonActive: { backgroundColor: "#7F936B", borderColor: "#7F936B" },
  roleText: { color: "#2D2D2D", fontWeight: "600" },
  roleTextActive: { color: "white" },
  input: { minHeight: 48, backgroundColor: "white", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  quotaRow: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 8 },
  quotaInput: { flex: 1, marginBottom: 0 },
  quotaButton: { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#7F936B", alignItems: "center", justifyContent: "center" },
  disabledButton: { opacity: 0.6 },
  quotaButtonText: { color: "white", fontWeight: "800" },
  primaryButton: { minHeight: 48, backgroundColor: "#7F936B", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "white", fontWeight: "700" },
  secondaryButton: { minHeight: 48, borderColor: "#7F936B", borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryText: { color: "#50603F", fontWeight: "700" },
  row: { color: "#2D2D2D", marginVertical: 4 },
  muted: { color: "#6F675E" },
  invitationRow: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 6 },
  invitationInfo: { marginBottom: 8 },
  actionGroup: { flexDirection: "row", gap: 12, borderTopColor: "#E2DDD5", borderTopWidth: 0.5, paddingTop: 8 },
  actionButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 8 },
  link: { color: "#50603F", fontWeight: "700" },
  danger: { color: "#B3261E", fontWeight: "700" },
});
