import * as Clipboard from "expo-clipboard";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";

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
  const members = useQuery(api.users.listFamilyMembers);
  const invitations = useQuery(api.invitations.listInvitations);
  const createInvitation = useMutation(api.invitations.createInvitation);
  const cancelInvitation = useMutation(api.invitations.cancelInvitation);
  const [role, setRole] = useState<Role>("ROLE-004");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
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

  return (
    <FlatList
      data={invitations}
      keyExtractor={(item: any) => item._id}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <View>
          <Text style={styles.kicker}>FamilyCal</Text>
          <Text style={styles.title}>Familieneinstellungen</Text>
          
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
              <Text key={member._id} style={styles.row}>
                {member.name || member.email} · {roleLabels[member.role] || member.role}
              </Text>
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
  card: { backgroundColor: "#FBF9F5", borderRadius: 12, padding: 16, marginBottom: 14, borderColor: "#E2DDD5", borderWidth: 1 },
  heading: { fontSize: 18, fontWeight: "700", color: "#2D2D2D", marginBottom: 10, marginTop: 10 },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  roleButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", paddingHorizontal: 12, justifyContent: "center", backgroundColor: "white" },
  roleButtonActive: { backgroundColor: "#7F936B", borderColor: "#7F936B" },
  roleText: { color: "#2D2D2D", fontWeight: "600" },
  roleTextActive: { color: "white" },
  input: { minHeight: 48, backgroundColor: "white", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
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
