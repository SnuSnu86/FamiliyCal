import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import React from "react";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";

import { colors, elevation, fonts, hitTarget, radius, spacing } from "../theme";

type Props = {
  digest?: { body?: string } | null;
  loading?: boolean;
  dateStr?: string;
};

export function SkeletonDailyDigestCard() {
  return (
    <View accessibilityLabel="Tageszusammenfassung wird geladen" style={styles.card}>
      <View style={styles.iconBubble}>
        <Ionicons name="sparkles" size={20} color={colors.sageDark} />
      </View>
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
      <View style={styles.row}>
        <View style={styles.iconBubble}>
          <Ionicons name="sparkles" size={20} color={colors.sageDark} />
        </View>
        <View style={styles.content}>
          <Text style={styles.overline}>Assistent</Text>
          <Text style={styles.title}>Dein Tagesüberblick</Text>
        </View>
      </View>
      <Text style={styles.body}>{digest?.body ?? "Deine Zusammenfassung wird im Hintergrund vorbereitet …"}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Druckansicht als PDF öffnen" style={styles.pdfButton} onPress={openPdf}>
        <Ionicons name="print-outline" size={16} color={colors.ink} />
        <Text style={styles.pdfButtonText}>Druckansicht (PDF)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    ...elevation.low,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.sageSoft,
  },
  content: { flex: 1 },
  overline: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: colors.inkFaint },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink, marginTop: 1 },
  body: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  pdfButton: {
    alignSelf: "flex-start",
    minHeight: hitTarget,
    marginTop: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  pdfButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  skeletonContent: { flex: 1, gap: spacing.sm },
  skeletonLine: { height: 14, width: "70%", borderRadius: 7, backgroundColor: colors.surfaceSunken },
  skeletonWide: { width: "92%" },
});
