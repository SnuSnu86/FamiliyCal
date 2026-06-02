import { StyleSheet, View } from "react-native";

import { useNetworkStatus } from "../hooks/useNetworkStatus";

const ONLINE_COLOR = "#7D9B84";
const OFFLINE_COLOR = "#C06C5C";

export function StatusDot() {
  const isOnline = useNetworkStatus();

  return (
    <View
      accessibilityLabel={isOnline ? "Online" : "Offline"}
      accessibilityRole="image"
      hitSlop={{ top: 20, right: 20, bottom: 20, left: 20 }}
      style={[styles.dot, { backgroundColor: isOnline ? ONLINE_COLOR : OFFLINE_COLOR }]}
      testID="status-dot"
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
