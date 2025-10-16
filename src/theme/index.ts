import { MD3LightTheme as DefaultTheme, MD3LightTheme } from 'react-native-paper';
import { supabase } from '../supabaseClient';

export function buildKidTheme(overrides?: Partial<MD3LightTheme['colors']> & { roundness?: number }): MD3LightTheme {
  const colors = {
    ...DefaultTheme.colors,
    primary: '#FF8C42',
    secondary: '#6C63FF',
    tertiary: '#06D6A0',
    background: '#FFF9E6',
    surface: '#FFFFFF',
    error: '#FF4D6D',
    ...overrides,
  };
  return {
    ...DefaultTheme,
    roundness: overrides?.roundness ?? 18,
    colors,
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
  }

  return overrides;
}

export function getFunctionUrl(name: string): string {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const match = url.match(/^https?:\/\/(.*?)\.supabase\.co/);
  const projectRef = match ? match[1] : '';
  return `https://${projectRef}.functions.supabase.co/${name}`;
}