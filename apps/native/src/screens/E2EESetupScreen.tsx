import NetInfo from "@react-native-community/netinfo";
import {
  deriveMasterKey,
  encodeBase64,
  encryptPrivateKey,
  exportPublicKey,
  generateE2EKeyPair,
  generateRandomSalt,
} from "@packages/shared";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

const LOCAL_PRIVATE_KEY_KEY = "familycal.e2ee.privateKeyJwk";

type Rule = { label: string; valid: boolean };

function evaluatePassphrase(passphrase: string): Rule[] {
  return [
    { label: "Mindestens 12 Zeichen", valid: passphrase.length >= 12 },
    { label: "Großbuchstabe", valid: /[A-Z]/.test(passphrase) },
    { label: "Kleinbuchstabe", valid: /[a-z]/.test(passphrase) },
    { label: "Zahl", valid: /\d/.test(passphrase) },
    { label: "Sonderzeichen", valid: /[^A-Za-z0-9]/.test(passphrase) },
  ];
}

async function storePrivateKeyJwk(privateKey: CryptoKey) {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const serialized = JSON.stringify(jwk);
  if (Platform.OS === "web") {
    try {
      sessionStorage.setItem(LOCAL_PRIVATE_KEY_KEY, serialized);
    } catch {
      localStorage.setItem(LOCAL_PRIVATE_KEY_KEY, serialized);
    }
    return;
  }
  await SecureStore.setItemAsync(LOCAL_PRIVATE_KEY_KEY, serialized, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export default function E2EESetupScreen() {
  const router = useRouter();
  const saveE2EEKeys = useMutation(api.users.saveE2EEKeys);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const rules = useMemo(() => evaluatePassphrase(passphrase), [passphrase]);
  const isStrong = rules.every((rule) => rule.valid);
  const matches = passphrase.length > 0 && passphrase === confirmPassphrase;

  async function handleSetup() {
    if (!isStrong || !matches) {
      Alert.alert("Passphrase prüfen", "Bitte erfülle alle Richtlinien und bestätige die gleiche Passphrase.");
      return;
    }

    const network = await NetInfo.fetch();
    if (network.isConnected === false || network.isInternetReachable === false) {
      Alert.alert("Offline", "Das E2EE-Setup ist nur online möglich, weil das verschlüsselte Backup gespeichert werden muss.");
      return;
    }

    setIsSaving(true);
    try {
      const salt = generateRandomSalt();
      const keyPair = await generateE2EKeyPair();
      const masterKey = await deriveMasterKey(passphrase, salt);
      const encrypted = await encryptPrivateKey(keyPair.privateKey, masterKey);
      const publicKey = await exportPublicKey(keyPair.publicKey);

      await storePrivateKeyJwk(keyPair.privateKey);
      await saveE2EEKeys({
        publicKey,
        encryptedPrivateKey: JSON.stringify(encrypted),
        keyDerivationSalt: encodeBase64(salt),
      });

      Alert.alert("Verschlüsselung aktiv", "Dein privater Schlüssel wurde lokal gespeichert und verschlüsselt gesichert.");
      router.replace("/settings");
    } catch (error) {
      Alert.alert("Fehler", error instanceof Error ? error.message : "E2EE konnte nicht eingerichtet werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>Sicherheit</Text>
      <Text style={styles.title}>Ende-zu-Ende-Verschlüsselung einrichten</Text>
      <Text style={styles.body}>
        Wähle eine starke Passphrase. Daraus wird nur auf deinem Gerät ein Master-Key abgeleitet; FamilyCal speichert nur ein verschlüsseltes Backup.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>E2EE-Passphrase</Text>
        <TextInput
          value={passphrase}
          onChangeText={setPassphrase}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Starke Passphrase eingeben"
          style={styles.input}
        />
        <Text style={styles.label}>Passphrase bestätigen</Text>
        <TextInput
          value={confirmPassphrase}
          onChangeText={setConfirmPassphrase}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Passphrase wiederholen"
          style={styles.input}
        />

        <View style={styles.rules}>
          {rules.map((rule) => (
            <Text key={rule.label} style={[styles.rule, rule.valid ? styles.ruleValid : styles.ruleInvalid]}>
              {rule.valid ? "✓" : "○"} {rule.label}
            </Text>
          ))}
          <Text style={[styles.rule, matches ? styles.ruleValid : styles.ruleInvalid]}>
            {matches ? "✓" : "○"} Bestätigung stimmt überein
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, (!isStrong || !matches || isSaving) && styles.disabledButton]}
          disabled={!isStrong || !matches || isSaving}
          onPress={handleSetup}
        >
          {isSaving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Verschlüsselung aktivieren</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: "#F5F2EB", padding: 20, paddingBottom: 40 },
  kicker: { color: "#6F675E", letterSpacing: 2, textTransform: "uppercase", marginTop: 12 },
  title: { color: "#2A2720", fontSize: 30, fontWeight: "800", marginTop: 8, marginBottom: 12 },
  body: { color: "#6F675E", fontSize: 16, lineHeight: 23, marginBottom: 18 },
  card: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 18, padding: 18 },
  label: { color: "#2A2720", fontWeight: "800", marginBottom: 8 },
  input: { minHeight: 52, backgroundColor: "white", borderColor: "#D6CFC3", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, marginBottom: 14 },
  rules: { backgroundColor: "#F1E8D8", borderRadius: 14, padding: 12, marginBottom: 16 },
  rule: { fontWeight: "700", marginVertical: 3 },
  ruleValid: { color: "#50603F" },
  ruleInvalid: { color: "#8A6A3A" },
  primaryButton: { minHeight: 52, borderRadius: 14, backgroundColor: "#7F936B", alignItems: "center", justifyContent: "center" },
  disabledButton: { opacity: 0.55 },
  primaryText: { color: "white", fontWeight: "800" },
});
