import clsx from 'clsx';
import { formatPrice } from '@/lib/utils';

/**
 * Compact "200W" line for ranking/grid cards: shows the latest 200-week SMA,
 * colored RED when it sits below the current price and GREEN when above
 * (per design: SMA below price → red, above → green).
 * Renders nothing when either value is missing (e.g. assets younger than ~4y).
 */
/** Compact "200D" line: latest 200-day SMA, RED when below price, GREEN when above. */
export function Ma200dLine({
  price,
  sma200d,
  currency = 'USD',
}: {
  price: number | null | undefined;
  sma200d: number | null | undefined;
  currency?: string | null;
}) {
  if (price == null || sma200d == null || sma200d <= 0) return null;
  const below = sma200d < price;
  const pct = (price / sma200d - 1) * 100; // how far the price is above/below the MA
  return (
    <p className={clsx('text-[10px] mt-0.5', below ? 'text-red-400' : 'text-emerald-400')}>
      200D: {formatPrice(sma200d, currency ?? 'USD')} <span className="opacity-70">({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</span>
    </p>
  );
}

export function Sma200wLine({
  price,
  sma200w,
  currency = 'USD',
}: {
  price: number | null | undefined;
  sma200w: number | null | undefined;
  currency?: string | null;
}) {
  if (price == null || sma200w == null || sma200w <= 0) return null;
  const below = sma200w < price;
  const pct = (price / sma200w - 1) * 100; // how far the price is above/below the MA
  return (
    <p className={clsx('text-[10px] mt-0.5', below ? 'text-red-400' : 'text-emerald-400')}>
      200W: {formatPrice(sma200w, currency ?? 'USD')} <span className="opacity-70">({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</span>
    </p>
  );
}
