import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, elevation, fonts, radius, spacing } from "../../theme";

type Props = {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  label?: string;
  bottomInset?: number;
};

/**
 * Primary floating action button. Extends to a pill when a label is supplied,
 * otherwise renders a circular FAB. Honors the device bottom inset so it never
 * collides with the home indicator / gesture bar.
 */
export function Fab({ onPress, accessibilityLabel, icon = "add", label, bottomInset = 0 }: Props) {
  const extended = !!label;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: spacing.lg + bottomInset }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.fab, extended && styles.extended, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={24} color={colors.onAccent} />
        {extended ? <Text style={styles.label}>{label}</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: spacing.lg, alignItems: "flex-end" },
  fab: {
    minWidth: 60,
    height: 60,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    backgroundColor: colors.sage,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    ...elevation.high,
  },
  extended: { paddingHorizontal: 22 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },
  label: { color: colors.onAccent, fontFamily: fonts.bodyBold, fontSize: 16 },
});
