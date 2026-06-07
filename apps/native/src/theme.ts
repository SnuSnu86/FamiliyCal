import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * FamilyCal design tokens.
 *
 * One source of truth for color, type, spacing, radius and elevation so the
 * native app reads like a single cohesive product instead of per-screen
 * one-offs. Typography maps to the fonts already bundled in the root layout
 * (Montserrat for display, Inter for UI/body).
 *
 * Aesthetic: "warm family hearth" — cream paper, sage + slate accents, a warm
 * charcoal ink, soft tactile elevation.
 */

export const colors = {
  // Surfaces
  paper: "#F2EEE5", // app background
  surface: "#FCFAF6", // raised cards / sheets
  surfaceSunken: "#EBE5D9", // segmented track, wells
  surfaceMuted: "#F6F2EA",

  // Ink
  ink: "#2A2720",
  inkSoft: "#6E695E",
  inkFaint: "#9B9384",

  // Lines
  line: "#E4DDD0",
  lineStrong: "#D8CFBE",

  // Brand / accents
  sage: "#7D9B84",
  sageDark: "#5F7E67",
  sageSoft: "#E6EEE5",
  slate: "#5C7C8A",
  slateSoft: "#E5EDEF",
  clay: "#C06C5C",
  claySoft: "#F3E0DB",
  amber: "#B07F2E",
  amberSoft: "#F4E9D2",

  // Fixed
  onAccent: "#FFFFFF",
  scrim: "rgba(34, 33, 27, 0.42)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/** Minimum interactive target — Android Material vs. iOS HIG. */
export const hitTarget = Platform.OS === "android" ? 48 : 44;

export const fonts = {
  displayBold: "MBold",
  displaySemiBold: "MSemiBold",
  displayMedium: "MMedium",
  bodyBold: "Bold",
  bodySemiBold: "SemiBold",
  bodyMedium: "Medium",
  bodyRegular: "Regular",
} as const;

export const type = {
  // Display (Montserrat)
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 32, color: colors.ink },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 18, lineHeight: 24, color: colors.ink },
  cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  // Body / UI (Inter)
  body: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  bodyStrong: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 22, color: colors.ink },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 18, color: colors.ink },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, color: colors.inkFaint },
  overline: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
    color: colors.inkFaint,
  },
} satisfies Record<string, TextStyle>;

/** Soft, warm elevation. iOS shadow + Android elevation in one object. */
export const elevation = {
  low: Platform.select<ViewStyle>({
    ios: { shadowColor: "#3D3322", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
    android: { elevation: 2 },
    default: {},
  })!,
  medium: Platform.select<ViewStyle>({
    ios: { shadowColor: "#3D3322", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16 },
    android: { elevation: 6 },
    default: {},
  })!,
  high: Platform.select<ViewStyle>({
    ios: { shadowColor: "#2A2418", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 24 },
    android: { elevation: 12 },
    default: {},
  })!,
} as const;

export const theme = { colors, spacing, radius, fonts, type, elevation, hitTarget };
export default theme;
