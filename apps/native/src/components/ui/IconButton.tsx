import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, type ViewStyle } from "react-native";

import { colors, elevation, hitTarget, radius } from "../../theme";

type Variant = "ghost" | "solid" | "tinted";

type Props = {
  name: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  variant?: Variant;
  size?: number;
  disabled?: boolean;
  style?: ViewStyle;
};

/** Circular, accessible icon button with consistent hit targets across the app. */
export function IconButton({ name, onPress, accessibilityLabel, variant = "ghost", size = 20, disabled, style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        variant === "solid" && styles.solid,
        variant === "tinted" && styles.tinted,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={variant === "solid" ? colors.onAccent : colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  solid: { backgroundColor: colors.sage, ...elevation.low },
  tinted: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.65, transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.4 },
});
