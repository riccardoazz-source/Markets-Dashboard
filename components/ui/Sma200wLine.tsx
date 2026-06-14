import clsx from 'clsx';
import { formatPrice } from '@/lib/utils';

/**
 * Compact "200W" line for ranking/grid cards: shows the latest 200-week SMA,
 * colored RED when it sits below the current price and GREEN when above
 * (per design: SMA below price → red, above → green).
 * Renders nothing when either value is missing (e.g. assets younger than ~4y).
 */
export function Sma200wLine({
  price,
  sma200w,
  currency = 'USD',
}: {
  price: number | null | undefined;
  sma200w: number | null | undefined;
  currency?: string | null;
}) {
  if (price == null || sma200w == null) return null;
  const below = sma200w < price;
  return (
    <p className={clsx('text-[10px] mt-0.5', below ? 'text-red-400' : 'text-emerald-400')}>
      200W: {formatPrice(sma200w, currency ?? 'USD')}
    </p>
  );
}
