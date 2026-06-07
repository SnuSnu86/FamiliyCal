import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { CalendarEvent } from "../database/models/CalendarEvent";
import { colors, elevation, fonts, radius, spacing } from "../theme";
import { VetoBadge } from "./VetoBadge";

type Props = {
  event: CalendarEvent;
  compact?: boolean;
  selected?: boolean;
  onPress?: (event: CalendarEvent) => void;
};

function accentColor(event: CalendarEvent): string {
  if (event.vetoStatus === "vetoed") return colors.clay;
  if (event.status === "draft") return colors.amber;
  return colors.slate;
}

export function CalendarCard({ event, compact = false, selected = false, onPress }: Props) {
  const opacity = useRef(new Animated.Value(event.serverId ? 1 : 0.6)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: event.serverId ? 1 : 0.6,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [event.serverId, opacity]);

  const card = (
    <Animated.View
      style={[styles.card, event.status === "draft" && styles.draftCard, compact && styles.compactCard, selected && styles.selectedCard, { opacity }]}
      testID="calendar-card"
    >
      <View style={[styles.colorBar, { backgroundColor: accentColor(event) }]} />
      <View style={[styles.content, compact && styles.compactContent]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={compact ? 2 : undefined}>
            {event.title}
          </Text>
          {event.vetoStatus === "vetoed" ? <VetoBadge /> : null}
        </View>
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={compact ? 11 : 13} color={colors.slate} />
          <Text style={[styles.time, compact && styles.compactTime]} numberOfLines={compact ? 1 : undefined}>
            {formatRange(event.startDate, event.endDate)}
          </Text>
        </View>
        {event.status === "draft" ? (
          <View style={[styles.badge, styles.draftBadge]}>
            <Text style={styles.draftBadgeText}>Vorschlag</Text>
          </View>
        ) : null}
        {"recurrenceErrorMessage" in event && event.recurrenceErrorMessage ? <Text style={styles.errorText}>{String(event.recurrenceErrorMessage)}</Text> : null}
        {!compact && event.description ? <Text style={styles.description}>{event.description}</Text> : null}
        {!event.serverId ? (
          <View style={[styles.badge, styles.offlineBadge]}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.inkSoft} />
            <Text style={styles.offlineBadgeText}>Offline gespeichert</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );

  if (!onPress) return card;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Termin ${event.title} auswählen`}
      onPress={() => onPress(event)}
      style={styles.pressable}
    >
      {card}
    </Pressable>
  );
}

function formatRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate} – ${endDate}`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const endLabel = sameDay ? end.toLocaleTimeString() : end.toLocaleString();
  return `${start.toLocaleString()} – ${endLabel}`;
}

const styles = StyleSheet.create({
  pressable: { minHeight: 48 },
  card: {
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs + 2,
    ...elevation.low,
  },
  compactCard: { marginHorizontal: spacing.xs, marginVertical: spacing.xs, borderRadius: radius.sm },
  selectedCard: { borderColor: colors.sage, borderWidth: 2 },
  draftCard: { borderColor: colors.amber, borderStyle: "dashed" },
  colorBar: { width: 4 },
  content: { flex: 1, padding: spacing.md },
  compactContent: { padding: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, flexShrink: 1 },
  compactTitle: { fontFamily: fonts.bodySemiBold, fontSize: 13 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  time: { fontFamily: fonts.bodyMedium, color: colors.slate, fontSize: 12, flexShrink: 1 },
  compactTime: { fontSize: 11 },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: spacing.sm },
  draftBadge: { backgroundColor: colors.amberSoft },
  draftBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.amber },
  offlineBadge: { backgroundColor: colors.surfaceSunken },
  offlineBadgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkSoft },
  errorText: { fontFamily: fonts.bodySemiBold, color: colors.clay, fontSize: 12, marginTop: spacing.xs },
  description: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
});
