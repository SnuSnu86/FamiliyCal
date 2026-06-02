import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { CalendarEvent } from "../database/models/CalendarEvent";

type Props = {
  event: CalendarEvent;
  compact?: boolean;
  selected?: boolean;
  onPress?: (event: CalendarEvent) => void;
};

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
      style={[styles.card, compact && styles.compactCard, selected && styles.selectedCard, { opacity }]}
      testID="calendar-card"
    >
      <View style={styles.colorBar} />
      <View style={[styles.content, compact && styles.compactContent]}>
        <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={compact ? 2 : undefined}>
          {event.title}
        </Text>
        <Text style={styles.time} numberOfLines={compact ? 1 : undefined}>
          {formatRange(event.startDate, event.endDate)}
        </Text>
        {"recurrenceErrorMessage" in event && event.recurrenceErrorMessage ? <Text style={styles.errorText}>{String(event.recurrenceErrorMessage)}</Text> : null}
        {!compact && event.description ? <Text style={styles.description}>{event.description}</Text> : null}
        {!event.serverId ? <Text style={styles.offlineLabel}>offline-card</Text> : null}
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
    borderRadius: 12,
    backgroundColor: "#FBF9F5",
    borderWidth: 1,
    borderColor: "#E2DDD5",
    marginHorizontal: 16,
    marginVertical: 8,
  },
  compactCard: { marginHorizontal: 4, marginVertical: 4, borderRadius: 10 },
  selectedCard: { borderColor: "#7D9B84", borderWidth: 2 },
  colorBar: { width: 4, backgroundColor: "#5C7C8A" },
  content: { flex: 1, padding: 12 },
  compactContent: { padding: 8 },
  title: { color: "#2A2720", fontSize: 16, fontWeight: "600" },
  compactTitle: { fontSize: 13 },
  time: { color: "#5C7C8A", marginTop: 4, fontSize: 12 },
  description: { color: "#2A2720", marginTop: 8 },
  errorText: { color: "#C06C5C", fontSize: 12, marginTop: 6, fontWeight: "600" },
  offlineLabel: { color: "#9A6B4F", fontSize: 12, marginTop: 6, fontWeight: "600" },
});
