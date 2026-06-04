const fs = require("fs");
const path = require("path");
const {
  withPlugins,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");
const { addImports } = require("@expo/config-plugins/build/android/codeMod");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const readFileAsync = (filePath) => fs.promises.readFile(filePath, "utf-8");
const writeFileAsync = (filePath, content) =>
  fs.promises.writeFile(filePath, content, "utf-8");

/** Gradle: link WatermelonDB JSI native module (from @skam22 plugin, Expo 55 compatible). */
const withAndroidJsiGradle = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const { platformProjectRoot } = config.modRequest;
      const projectDir = `new File(["node", "--print", "require.resolve('@nozbe/watermelondb/package.json')"].execute(null, rootDir).text.trim(), "../native/android-jsi")`;

      const settingsFile = path.join(platformProjectRoot, "settings.gradle");
      const settingsContents = await readFileAsync(settingsFile);
      await writeFileAsync(
        settingsFile,
        mergeContents({
          tag: "familycal-watermelondb-jsi-settings",
          src: settingsContents,
          newSrc: `
\tinclude ':watermelondb-jsi'
\tproject(':watermelondb-jsi').projectDir = ${projectDir}`,
          offset: 0,
          comment: "//",
          anchor: "include ':app'",
        }).contents
      );

      const buildFile = path.join(platformProjectRoot, "app/build.gradle");
      const buildContents = await readFileAsync(buildFile);
      await writeFileAsync(
        buildFile,
        mergeContents({
          tag: "familycal-watermelondb-jsi-build",
          src: buildContents,
          newSrc: "implementation project(':watermelondb-jsi')",
          offset: 4,
          comment: "//",
          anchor:
            /def isGifEnabled = \(findProperty\('expo\.gif\.enabled'\) \?: ""\) == "true";/,
        }).contents
      );

      const proguardFile = path.join(
        platformProjectRoot,
        "app/proguard-rules.pro"
      );
      const proguardContents = await readFileAsync(proguardFile);
      await writeFileAsync(
        proguardFile,
        mergeContents({
          tag: "familycal-watermelondb-proguard",
          src: proguardContents,
          newSrc: "-keep class com.nozbe.watermelondb.** { *; }",
          offset: 0,
          comment: "#",
          anchor: /# Add any project specific keep options here:/,
        }).contents
      );

      return config;
    },
  ]);

/** Expo SDK 55: register WatermelonDBJSIPackage in ReactHost PackageList. */
const withAndroidMainApplication = (config) =>
  withMainApplication(config, (config) => {
    let contents = addImports(
      config.modResults.contents,
      ["com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage"],
      false
    );

    contents = mergeContents({
      tag: "familycal-watermelondb-package",
      src: contents,
      newSrc: "          add(WatermelonDBJSIPackage())",
      anchor: /PackageList\(this\)\.packages\.apply \{/,
      offset: 1,
      comment: "//",
    }).contents;

    config.modResults.contents = contents;
    return config;
  });

const withWatermelonDB = (config) =>
  withPlugins(config, [withAndroidJsiGradle, withAndroidMainApplication]);

module.exports = withWatermelonDB;
