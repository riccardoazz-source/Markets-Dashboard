// ─────────────────────────────────────────────────────────────────────────────
// Rotation phase — the quadrant an asset sits in, shared across the whole app.
//
// Two axes (same as the Rotation Quadrant): X = 3-month return, Y = the model's
// EMS score percentile (0–100). Split at X = 0 and Y = 50 (median):
//   Recovering (top-left)  : high score, weak 3M   → turning up early (before it shows)
//   Trending   (top-right) : high score, strong 3M → confirmed uptrend — the buys
//   Fading     (bottom-right): weak score, strong 3M → rolling over, watch for exit
//   Lagging    (bottom-left) : weak score, weak 3M   → avoid
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPhase = 'Recovering' | 'Trending' | 'Fading' | 'Lagging';

export const ROTATION_PHASES: RotationPhase[] = ['Recovering', 'Trending', 'Fading', 'Lagging'];

// scorePctile: 0–100 (cross-sectional EMS-score percentile). r3m: 3-month return %.
// Returns null when the 3-month return is unknown (can't place on the X-axis).
export function classifyPhase(scorePctile: number | null, r3m: number | null | undefined): RotationPhase | null {
  if (scorePctile == null || r3m == null) return null;
  const top = scorePctile >= 50;
  const right = r3m > 0;
  if (top) return right ? 'Trending' : 'Recovering';
  return right ? 'Fading' : 'Lagging';
}

export const PHASE_META: Record<RotationPhase, { label: string; cls: string; dot: string; hint: string }> = {
  Recovering: {
    label: 'Recovering', dot: '#60a5fa',
    cls: 'bg-blue-500/15 text-blue-300',
    hint: 'Recovering — the model rates it highly but its 3-month return is still weak: turning up early, before it shows in price.',
  },
  Trending: {
    label: 'Trending', dot: '#22c55e',
    cls: 'bg-green-500/15 text-green-300',
    hint: 'Trending — high model score and already up over 3 months: a confirmed uptrend (the names the model recommends to buy).',
  },
  Fading: {
    label: 'Fading', dot: '#d97706',
    cls: 'bg-amber-500/15 text-amber-300',
    hint: 'Fading — still up over 3 months but the model score is slipping: momentum rolling over, watch for the exit.',
  },
  Lagging: {
    label: 'Lagging', dot: '#f87171',
    cls: 'bg-red-500/15 text-red-300',
    hint: 'Lagging — weak 3-month return and a low model score: decelerating, best avoided.',
  },
};
