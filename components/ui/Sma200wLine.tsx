import clsx from 'clsx';
import { formatPrice } from '@/lib/utils';

/**
 * Compact "200D"/"200W" lines for ranking/grid cards: show the latest SMA plus
 * how far the price sits above/below it. Coloured GREEN when the price is above
 * the average (positive distance) and RED when below.
 * Render nothing when either value is missing (e.g. assets younger than ~4y).
 */
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
  const pct = (price / sma200d - 1) * 100; // how far the price is above/below the MA
  return (
    <p className={clsx('text-[10px] mt-0.5', pct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
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
  const pct = (price / sma200w - 1) * 100; // how far the price is above/below the MA
  return (
    <p className={clsx('text-[10px] mt-0.5', pct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
      200W: {formatPrice(sma200w, currency ?? 'USD')} <span className="opacity-70">({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</span>
    </p>
  );
}
