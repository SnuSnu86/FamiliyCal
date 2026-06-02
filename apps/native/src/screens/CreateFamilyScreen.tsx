import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";

function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err && err.data) {
    return String(err.data);
  }
  if (err instanceof Error) {
    return err.message.replace(/^ConvexError:\s*/, "");
  }
  return "Die Familie konnte nicht erstellt werden.";
}

export default function CreateFamilyScreen() {
  const createFamily = useMutation(api.families.create);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreateFamily() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Bitte gib einen Familiennamen ein.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("Der Familienname darf maximal 100 Zeichen lang sein.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await createFamily({ name: trimmedName });
      // If successful, we don't reset isSubmitting because the component will unmount
    } catch (err) {
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.eyebrow}>FamilyCal einrichten</Text>
            <Text style={styles.title}>Erstelle deine Familiengruppe</Text>
            <Text style={styles.description}>
              Deine Familie ist der gemeinsame Arbeitsbereich für Kalender, Chats
              und Speicher-Quotas. Du wirst automatisch als Family Owner angelegt.
            </Text>

            <Text style={styles.label}>Familienname</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="z. B. Familie Schmidt"
              editable={!isSubmitting}
              autoCapitalize="words"
              maxLength={100}
              style={styles.input}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handleCreateFamily}
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>
                {isSubmitting ? "Familie wird erstellt …" : "Familie erstellen"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F2EB",
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FBF9F5",
    borderColor: "#E2DDD5",
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  eyebrow: {
    color: "#6F675E",
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.6,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  title: {
    color: "#2D2D2D",
    fontFamily: "System",
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  description: {
    color: "#6F675E",
    fontFamily: "System",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
  },
  label: {
    color: "#3A352F",
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2DDD5",
    borderRadius: 12,
    borderWidth: 1,
    color: "#2D2D2D",
    fontFamily: "System",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  error: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F3C6C6",
    borderRadius: 12,
    borderWidth: 1,
    color: "#B3261E",
    fontFamily: "System",
    fontSize: 14,
    marginTop: 14,
    padding: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#7D9B84",
    borderRadius: 12,
    marginTop: 20,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
});
