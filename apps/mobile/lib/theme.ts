/** Mêmes tokens que le web (apps/web/app/globals.css). */
export const colors = {
  void: "#07060B",
  abyss: "#0D0B14",
  surface: "#14111F",
  surface2: "#1C1830",
  line: "#2A2442",
  violet: "#8B5CF6",
  violetSoft: "#A78BFA",
  neon: "#22D3EE",
  neonBlue: "#3B82F6",
  ink: "#ECE9F7",
  muted: "#8F88A8",
  success: "#34D399",
  warn: "#FBBF24",
  danger: "#F43F5E",
} as const;

export const radius = { card: 20, chip: 12 } as const;

export const font = {
  display: { fontWeight: "700" as const, letterSpacing: 0.5 },
  hud: { fontSize: 11, letterSpacing: 2, textTransform: "uppercase" as const, color: colors.muted },
};
