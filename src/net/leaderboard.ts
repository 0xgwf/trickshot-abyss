// Shared LAN leaderboard (served by server.mjs). Every call fails soft: offline means no board.

export interface ScoreEntry {
  name: string;
  char: string;
  won: boolean;
  time: number;
  kills: number;
  level: number;
  progress: number;
  stage?: string;
  layer?: number;
  at: number;
}

export interface Board {
  top: ScoreEntry[];
  total: number;
  rank?: number;
}

async function call(init?: RequestInit): Promise<Board | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch('/api/scores', { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Board;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const fetchBoard = () => call();

export const submitScore = (e: Omit<ScoreEntry, 'at'>) =>
  call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
