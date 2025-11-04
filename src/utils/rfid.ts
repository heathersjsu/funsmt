export function normalizeRfid(input: string): string {
  if (!input) return input;
  const clean = input.replace(/[^0-9a-fA-F]/g, "");
  return clean.toUpperCase();
}

export function isValidRfid(input: string): boolean {
  if (!input) return false;
  const clean = input.replace(/[^0-9a-fA-F]/g, "");
  return clean.length > 0 && clean.length % 2 === 0;
}

export function formatRfidDisplay(input?: string | null, last: number = 6): string {
  if (!input) return '-';
  const clean = normalizeRfid(input);
  if (!clean) return '-';
  const len = clean.length;
  const start = Math.max(0, len - last);
  return clean.slice(start);
}