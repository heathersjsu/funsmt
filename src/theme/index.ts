import { MD3LightTheme as DefaultTheme, MD3LightTheme, configureFonts } from 'react-native-paper';
import { supabase } from '../supabaseClient';

export function buildKidTheme(overrides?: Partial<MD3LightTheme['colors']> & { roundness?: number }): MD3LightTheme {
  // Figma-inspired calmer palette (Chill Calendar style)
  const colors = {
    ...DefaultTheme.colors,
    primary: '#6C63FF', // calm purple
    secondary: '#7BC6FF', // soft blue accent
    tertiary: '#06D6A0', // green for success/positive
    background: '#F7F7FB', // light neutral background
    surface: '#FFFFFF',
    error: '#EF476F',
    ...overrides,
  };
  return {
    ...DefaultTheme,
    roundness: overrides?.roundness ?? 16,
    colors,
  } as MD3LightTheme;
}

// Food Delivery style palette: warm brand, sunny accent, clean surfaces
export function buildFoodTheme(overrides?: Partial<MD3LightTheme['colors']> & { roundness?: number }): MD3LightTheme {
  const colors = {
    ...DefaultTheme.colors,
    primary: '#FF4C29', // vibrant coral/orange brand
    secondary: '#FFC107', // golden accent (CTA/highlight)
    tertiary: '#4CD964', // success green
    background: '#FFF8F2', // warm soft background
    surface: '#FFFFFF',
    error: '#E53935',
    ...overrides,
  };
  return {
    ...DefaultTheme,
    roundness: overrides?.roundness ?? 16,
    colors,
  } as MD3LightTheme;
}

// Cartoon/Kid-friendly playful theme: aligned with ToyListScreen palette
export function buildCartoonTheme(overrides?: Partial<MD3LightTheme['colors']> & { roundness?: number }): MD3LightTheme {
  // Unified kid-friendly fonts: Baloo 2 for titles, Nunito for body
  const fonts = {
    ...DefaultTheme.fonts,
    displayLarge: { ...DefaultTheme.fonts.displayLarge, fontFamily: 'Baloo 2', fontWeight: '700' },
    headlineLarge: { ...DefaultTheme.fonts.headlineLarge, fontFamily: 'Baloo 2', fontWeight: '700' },
    titleLarge: { ...DefaultTheme.fonts.titleLarge, fontFamily: 'Baloo 2', fontWeight: '700' },
    titleMedium: { ...DefaultTheme.fonts.titleMedium, fontFamily: 'Baloo 2', fontWeight: '700' },
    titleSmall: { ...DefaultTheme.fonts.titleSmall, fontFamily: 'Baloo 2', fontWeight: '700' },
    labelLarge: { ...DefaultTheme.fonts.labelLarge, fontFamily: 'Nunito', fontWeight: '600' },
    bodyLarge: { ...DefaultTheme.fonts.bodyLarge, fontFamily: 'Nunito', fontWeight: '400' },
    bodyMedium: { ...DefaultTheme.fonts.bodyMedium, fontFamily: 'Nunito', fontWeight: '400' },
    bodySmall: { ...DefaultTheme.fonts.bodySmall, fontFamily: 'Nunito', fontWeight: '400' },
  } as MD3LightTheme['fonts'];
  const colors = {
    ...DefaultTheme.colors,
    primary: '#FF8C42', // playful orange (buttons, highlights)
    secondary: '#6C63FF', // friendly purple (chips, accents)
    tertiary: '#00C2FF', // bright sky blue (links, info)
    background: '#FFF9E6', // soft creamy background
    surface: '#FFFFFF',
    error: '#FF6B6B', // lively red for errors
    // Improve MD3 container accents used by Chips and Tonal buttons
    secondaryContainer: '#FFE7D1',
    // Allow overrides from Figma or env to take precedence
    ...overrides,
  };
  return {
    ...DefaultTheme,
    roundness: overrides?.roundness ?? 20, // slightly larger roundness for capsule-like buttons
    colors,
    fonts,
  } as MD3LightTheme;
}

type FigmaVariable = {
  id: string;
  name: string;
  variable_type: string | null;
  values: Record<string, any> | null; // modeId -> value
};

function figmaColorToHex(input: any): string | null {
  // Try Figma color object { r,g,b,a } in 0..1
  const c = input as { r?: number; g?: number; b?: number; a?: number };
  if (typeof c?.r === 'number' && typeof c?.g === 'number' && typeof c?.b === 'number') {
    const r = Math.round((c.r ?? 0) * 255);
    const g = Math.round((c.g ?? 0) * 255);
    const b = Math.round((c.b ?? 0) * 255);
    return `#${[r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase();
  }
  // Fallback: if already hex-like
  if (typeof input === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(input)) return input;
  return null;
}

export async function loadFigmaThemeOverrides(): Promise<Partial<MD3LightTheme['colors']>> {
  const overrides: Partial<MD3LightTheme['colors']> = {};
  const { data } = await supabase
    .from('figma_variables')
    .select('id,name,variable_type,values')
    .limit(200);
  const vars = (data || []) as FigmaVariable[];
  const colorVars = vars.filter((v) => (v.variable_type || '').toUpperCase() === 'COLOR' && v.values);
  const pickValue = (v: FigmaVariable) => {
    const vals = v.values || {};
    const firstKey = Object.keys(vals)[0];
    return firstKey ? vals[firstKey] : null;
  };

  for (const v of colorVars) {
    const name = v.name.toLowerCase();
    const val = figmaColorToHex(pickValue(v));
    if (!val) continue;
    if (name.includes('primary')) overrides.primary = val as any;
    else if (name.includes('secondary')) overrides.secondary = val as any;
    else if (name.includes('tertiary')) overrides.tertiary = val as any;
    else if (name.includes('background')) overrides.background = val as any;
    else if (name.includes('surface')) overrides.surface = val as any;
    else if (name.includes('error')) overrides.error = val as any;
    else if (name.includes('secondarycontainer')) overrides.secondaryContainer = val as any;
  }

  return overrides;
}

export function getFunctionUrl(name: string): string {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const match = url.match(/^https?:\/\/(.*?)\.supabase\.co/);
  const projectRef = match ? match[1] : '';
  return `https://${projectRef}.functions.supabase.co/${name}`;
}