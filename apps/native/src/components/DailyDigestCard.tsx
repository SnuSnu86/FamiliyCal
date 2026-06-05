import { useMutation } from "convex/react";
import React from "react";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";

type Props = {
  digest?: { body?: string } | null;
  loading?: boolean;
  dateStr?: string;
};

export function SkeletonDailyDigestCard() {
  return (
    <View accessibilityLabel="Tageszusammenfassung wird geladen" style={styles.card}>
      <View style={styles.iconBubble}><Text style={styles.icon}>💡</Text></View>
      <View style={styles.skeletonContent}>
        <View style={[styles.skeletonLine, styles.skeletonWide]} />
        <View style={styles.skeletonLine} />
      </View>
    </View>
  );
}

export function DailyDigestCard({ digest, loading, dateStr = new Date().toISOString().slice(0, 10) }: Props) {
  const createDownloadToken = useMutation(api.agents.createDownloadToken);

  const openPdf = async () => {
    try {
      const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
      if (!webUrl) throw new Error("EXPO_PUBLIC_WEB_URL ist nicht gesetzt.");
      const ticket = await createDownloadToken({ dateStr });
      if (!ticket) throw new Error("Kein gültiges Ticket verfügbar.");
      const pdfUrl = `${webUrl.replace(/\/$/, "")}/api/digest/pdf?date=${encodeURIComponent(dateStr)}&ticket=${encodeURIComponent(ticket)}`;
      await Linking.openURL(pdfUrl);
    } catch (error: any) {
      Alert.alert("PDF nicht verfügbar", error?.message ?? "Die Druckansicht konnte nicht geöffnet werden.");
    }
  };

  if (loading) return <SkeletonDailyDigestCard />;

  return (
    <View accessibilityLabel="Tageszusammenfassung" style={styles.card}>
      <View style={styles.iconBubble}><Text style={styles.icon}>🤖</Text></View>
      <View style={styles.content}>
        <Text style={styles.title}>Dein Tagesüberblick</Text>
        <Text style={styles.body}>{digest?.body ?? "Deine Zusammenfassung wird im Hintergrund vorbereitet …"}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Druckansicht als PDF öffnen" style={styles.pdfButton} onPress={openPdf}>
          <Text style={styles.pdfButtonText}>🖨 Druckansicht (PDF)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 92,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2DDD5",
    backgroundColor: "#FBF9F5",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(125, 155, 132, 0.15)",
  },
  icon: { fontSize: 22 },
  content: { flex: 1 },
  title: { color: "#2A2720", fontSize: 16, fontWeight: "700", marginBottom: 4 },
  body: { color: "#706B60", lineHeight: 20 },
  pdfButton: { alignSelf: "flex-start", minHeight: 44, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: "#2A2720", paddingHorizontal: 12, justifyContent: "center", backgroundColor: "#FFFFFF" },
  pdfButtonText: { color: "#2A2720", fontWeight: "700" },
  skeletonContent: { flex: 1, gap: 10 },
  skeletonLine: { height: 14, width: "70%", borderRadius: 7, backgroundColor: "#E2DDD5" },
  skeletonWide: { width: "92%" },
});
