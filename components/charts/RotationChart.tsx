'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { HistoricalPoint } from '@/lib/types';

export interface ChartAsset {
  symbol: string;
  name: string;
  color: string;
}

interface RotationChartProps {
  assets: ChartAsset[];
  timeframe: '1M' | '3M' | '6M' | '1Y';
}

type ChartPoint = Record<string, number | string | null>;

const timeframeParam: Record<string, string> = {
  '1M': '1M',
  '3M': '3M',
  '6M': '6M',
  '1Y': '1Y',
};

export function RotationChart({ assets, timeframe }: RotationChartProps) {
  const cacheRef = useRef<Map<string, Map<string, HistoricalPoint[]>>>(new Map());
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (assets.length === 0) {
      setChartData([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        if (!cacheRef.current.has(timeframe)) {
          cacheRef.current.set(timeframe, new Map());
        }
        const tfCache = cacheRef.current.get(timeframe)!;

        const toFetch = assets.filter(a => !tfCache.has(a.symbol));
        if (toFetch.length > 0) {
          const results = await Promise.all(
            toFetch.map(a =>
              fetch(`/api/historical?symbol=${encodeURIComponent(a.symbol)}&timeframe=${timeframeParam[timeframe]}`)
                .then(r => r.ok ? (r.json() as Promise<HistoricalPoint[]>) : Promise.resolve([] as HistoricalPoint[]))
                .catch(() => [] as HistoricalPoint[])
            )
          );
          toFetch.forEach((a, i) => tfCache.set(a.symbol, results[i]));
        }

        if (cancelled) return;

        const seriesMap = new Map<string, Map<string, number>>();
        const allDates = new Set<string>();

        for (const asset of assets) {
          const pts = tfCache.get(asset.symbol) ?? [];
          if (pts.length === 0) continue;
          const firstClose = pts[0].close;
          if (!firstClose) continue;
          const normalized = new Map<string, number>();
          for (const pt of pts) {
            normalized.set(pt.date, ((pt.close / firstClose) - 1) * 100);
            allDates.add(pt.date);
          }
          seriesMap.set(asset.symbol, normalized);
        }

        const sortedDates = Array.from(allDates).sort();
        const built: ChartPoint[] = sortedDates.map(date => {
          const pt: ChartPoint = { date };
          for (const asset of assets) {
            const series = seriesMap.get(asset.symbol);
            pt[asset.symbol] = series ? (series.get(date) ?? null) : null;
          }
          return pt;
        });

        setChartData(built);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [assets, timeframe]);

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-[320px] text-sm text-gray-500">
        Select rows above to see performance over time
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[320px]">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  const tickFormatter = (d: string) => {
    const date = new Date(d);
    const n = chartData.length;
    if (n < 60) return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    if (n < 500) return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    return String(date.getFullYear());
  };

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1e293b" strokeDasharray="0" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          tickFormatter={tickFormatter}
        />
        <YAxis
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`}
          width={52}
        />
        <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
        <Tooltip
          contentStyle={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            fontSize: 11,
            padding: '6px 10px',
          }}
          labelStyle={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}
          formatter={(val: number, name: string) => {
            const asset = assets.find(a => a.symbol === name);
            return [
              `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`,
              asset?.name ?? name,
            ];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value: string) => {
            const asset = assets.find(a => a.symbol === value);
            return <span style={{ color: '#9ca3af' }}>{asset?.name ?? value}</span>;
          }}
        />
        {assets.map(asset => (
          <Line
            key={asset.symbol}
            type="monotone"
            dataKey={asset.symbol}
            stroke={asset.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
