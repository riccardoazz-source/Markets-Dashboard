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

/**
 * Spread between the two averages: how far the 200-DAY average sits above (or
 * below) the 200-WEEK average, in %. Unlike the two lines above — which measure
 * today's price against a trend — this compares the medium-term trend with the
 * long-term one, so it reads the REGIME rather than the moment:
 *
 *   > 0  the 200D is above the 200W → established uptrend. The larger the number,
 *        the more the recent trend is stretched above its long-term base.
 *   < 0  the 200D has fallen through the 200W → long-term downtrend.
 *   ≈ 0  the two are crossing: a long-horizon regime change.
 *
 * It moves slowly by construction, so it is a backdrop reading, not a signal.
 */
export function MaSpreadLine({
  sma200d,
  sma200w,
}: {
  sma200d: number | null | undefined;
  sma200w: number | null | undefined;
}) {
  if (sma200d == null || sma200w == null || sma200w <= 0 || sma200d <= 0) return null;
  const pct = (sma200d / sma200w - 1) * 100;
  return (
    <p
      className={clsx('text-[10px] mt-0.5', pct >= 0 ? 'text-emerald-400/80' : 'text-red-400/80')}
      title="200-day average vs 200-week average. Positive = medium-term trend above the long-term base (uptrend); negative = below it (downtrend); near zero = regime change."
    >
      <span className="text-gray-500">200D vs 200W:</span> {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </p>
  );
}
