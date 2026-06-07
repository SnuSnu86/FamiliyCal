import { DatabaseProvider } from "@nozbe/watermelondb/DatabaseProvider";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import ConvexClientProvider from "../../ConvexClientProvider";
import { database } from "../database";
import { colors } from "../theme";

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
    <SafeAreaProvider>
      <DatabaseProvider database={database}>
        <ConvexClientProvider>
          <AppShell />
        </ConvexClientProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

/**
 * Renders the navigation stack with a themed status-bar spacer. The spacer
 * uses the real device top inset so content never sits under the notch, and
 * matches the warm paper background instead of a clashing accent bar.
 */
function AppShell() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <View style={{ height: insets.top, backgroundColor: colors.paper }} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }} />
    </View>
  );
}
