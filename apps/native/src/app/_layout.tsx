import { DatabaseProvider } from "@nozbe/watermelondb/DatabaseProvider";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { Platform, StatusBar, View, StyleSheet } from "react-native";
import ConvexClientProvider from "../../ConvexClientProvider";
import { database } from "../database";
import { StatusDot } from "../components/StatusDot";
import { toCamelCase } from "@packages/shared";

const statusBarHeight =
  Platform.OS === "ios" ? 50 : (StatusBar.currentHeight ?? 0);

export default function RootLayout() {
  const [loaded] = useFonts({
    Bold: require("../assets/fonts/Inter-Bold.ttf"),
    SemiBold: require("../assets/fonts/Inter-SemiBold.ttf"),
    Medium: require("../assets/fonts/Inter-Medium.ttf"),
    Regular: require("../assets/fonts/Inter-Regular.ttf"),
    MBold: require("../assets/fonts/Montserrat-Bold.ttf"),
    MSemiBold: require("../assets/fonts/Montserrat-SemiBold.ttf"),
    MMedium: require("../assets/fonts/Montserrat-Medium.ttf"),
    MRegular: require("../assets/fonts/Montserrat-Regular.ttf"),
    MLight: require("../assets/fonts/Montserrat-Light.ttf"),
  });

  if (!loaded) return null;

  return (
    <DatabaseProvider database={database}>
      <ConvexClientProvider>
        <View style={{ flex: 1 }}>
          <View style={{ height: statusBarHeight, backgroundColor: "#0D87E1" }}>
            <StatusBar
              translucent
              backgroundColor="#0D87E1"
              barStyle="light-content"
            />
          </View>
          <Stack screenOptions={{ headerShown: false }} />
          <View style={styles.globalStatusDotContainer}>
            <StatusDot />
          </View>
        </View>
      </ConvexClientProvider>
    </DatabaseProvider>
  );
}

const styles = StyleSheet.create({
  globalStatusDotContainer: {
    position: "absolute",
    top: statusBarHeight + 21,
    right: 72,
    zIndex: 9999,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
