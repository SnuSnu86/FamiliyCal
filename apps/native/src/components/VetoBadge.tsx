import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function VetoBadge() {
  return (
    <View accessibilityLabel="Einspruch markiert" style={styles.badge}>
      <Text style={styles.text}>❗ Einspruch</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    backgroundColor: "#C06C5C",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});
