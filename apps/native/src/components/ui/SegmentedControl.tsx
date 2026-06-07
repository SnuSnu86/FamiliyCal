import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, elevation, fonts, radius, spacing } from "../../theme";

type Segment<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/** iOS-style segmented control with a raised "thumb" on the active segment. */
export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.track}>
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={segment.label}
            onPress={() => onChange(segment.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{segment.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: 4,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.surface, ...elevation.low },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSoft },
  textActive: { color: colors.ink },
});
