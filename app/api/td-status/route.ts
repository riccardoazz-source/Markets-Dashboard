import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.TWELVEDATA_API_KEY ?? '319ddc9917744390a29a35966040a078';

// Diagnostic endpoint — hit /api/td-status?symbol=XLK to see exactly
// what Twelve Data returns from Vercel
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'XLK';
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* leave as text */ }
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url,
      keyUsed: API_KEY.slice(0, 8) + '...',
      response: parsed ?? text.slice(0, 500),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: (e as Error).message,
      url,
      keyUsed: API_KEY.slice(0, 8) + '...',
    });
  } finally {
    clearTimeout(t);
  }
}
