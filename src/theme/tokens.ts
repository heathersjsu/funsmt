// Centralized design tokens for cartoon theme unification
// Keep colors in sync with buildCartoonTheme()

export const cartoonGradient = ["#FFF4D6", "#FFE5EC", "#EDE7FF"] as const;

// Light purple fill color for flat inputs on provisioning screens
export const softPurpleFill = "#F3E8FF"; // gentle lavender background

// Orange gradient for primary call-to-action (Save) capsule button
export const orangeCapsuleGradient = ["#FFB86C", "#FF8A00"] as const;

// Status icon colors (temporary constants). TODO: map to theme when MD3 exposes custom slots.
export const statusColors = {
  online: '#4CAF50',
  offline: '#9E9E9E',
  warning: '#FFC107',
  danger: '#EF476F',
} as const;

// Standard icon size for list leading icons
export const listIconSize = 32;

// Unified card roundness, match buildCartoonTheme roundness
export const cardRoundness = 20;

// Helper: get common semantic colors from theme
// Use theme.colors.error for errors; .primary/.secondary for brand accents
export const getSemanticsFromTheme = (theme: any) => ({
  bg: theme.colors.background,
  surface: theme.colors.surface,
  brand: theme.colors.primary,
  accent: theme.colors.secondary,
  info: theme.colors.tertiary,
  error: theme.colors.error,
  secondaryContainer: theme.colors.secondaryContainer,
});