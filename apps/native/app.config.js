/** Use RN community autolinking so WatermelonDB's native/android folder is picked up. */
process.env.EXPO_USE_COMMUNITY_AUTOLINKING ??= "1";

const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    plugins: [
      ...(appJson.expo.plugins ?? []).filter(
        (plugin) =>
          plugin !== "@skam22/watermelondb-expo-plugin" &&
          !(
            Array.isArray(plugin) &&
            plugin[0] === "@skam22/watermelondb-expo-plugin"
          )
      ),
      "./plugins/withWatermelonDB",
    ],
  },
};
