import * as Clipboard from "expo-clipboard";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useFamilyId } from "../hooks/useFamilyId";
import { useUser } from "@clerk/expo";

type Role = "ROLE-002" | "ROLE-003" | "ROLE-004" | "ROLE-005" | "ROLE-006";

const roles: Role[] = ["ROLE-002", "ROLE-003", "ROLE-004", "ROLE-005", "ROLE-006"];

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
  const { user: clerkUser } = useUser();
  const members = useQuery(api.users.listFamilyMembers);
  const invitations = useQuery(api.invitations.listInvitations);
  const createInvitation = useMutation(api.invitations.createInvitation);
  const cancelInvitation = useMutation(api.invitations.cancelInvitation);
  const updateUserStorageLimit = useMutation(api.memos.updateUserStorageLimit);
  const storageStatus = useQuery(api.memos.getStorageStatus, familyId ? { familyId: familyId as any } : "skip");
  const [role, setRole] = useState<Role>("ROLE-004");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [storageLimitByUserId, setStorageLimitByUserId] = useState<Record<string, string>>({});
  const [savingLimitByUserId, setSavingLimitByUserId] = useState<Record<string, boolean>>({});
  const baseUrl = useMemo(() => process.env.EXPO_PUBLIC_WEB_URL ?? "https://familycal.app", []);

  const isLoading = members === undefined || invitations === undefined;

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
  const currentMember = members.find((member: any) => member.clerkId === clerkUser?.id);
  const canManageQuotas = currentMember?.role === "ROLE-001" || currentMember?.role === "ROLE-002";

  function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  async function saveChildQuota(member: any) {
    if (!familyId) return;
    const raw = storageLimitByUserId[member._id] !== undefined
      ? storageLimitByUserId[member._id]
      : (member.storageLimit !== undefined && member.storageLimit !== null
        ? String(Math.round(member.storageLimit / 1048576))
        : "");
    const clean = raw.trim();
    const mb = clean === "" ? undefined : Number(clean);

    if (clean !== "" && (!Number.isFinite(mb) || Number(mb) < 0)) {
      Alert.alert("Ungültige Quota", "Bitte gib eine positive Zahl in MB ein oder lasse das Feld leer.");
      return;
    }

    setSavingLimitByUserId((prev) => ({ ...prev, [member._id]: true }));
    try {
      const bytes = mb === undefined ? undefined : Math.floor(Number(mb) * 1024 * 1024);
      await updateUserStorageLimit({ familyId: familyId as any, userId: member._id, storageLimit: bytes });
      setStorageLimitByUserId((prev) => ({ ...prev, [member._id]: clean }));
      Alert.alert("Gespeichert", clean ? "Unter-Quota wurde aktualisiert." : "Unter-Quota wurde entfernt.");
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
              <Text style={styles.storagePercent}>{Math.round(percent * 100)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(percent * 100))}%` }]} />
            </View>
            <Text style={styles.muted}>
              {formatBytes(used)} von {formatBytes(quota)} belegt
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
  heading: { fontSize: 18, fontWeight: "700", color: "#2D2D2D", marginBottom: 10, marginTop: 10 },
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
