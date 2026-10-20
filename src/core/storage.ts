// Small localStorage wrapper. Keys used to be prefixed "bxp." before the project was renamed,
// so reads fall back to the old key to keep players' unlocks and names.
const PREFIX = 'tsa.';
const LEGACY = 'bxp.';

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key) ?? localStorage.getItem(LEGACY + key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // storage unavailable (private mode etc.)
  }
}
