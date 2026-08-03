// Check the indicators against PUBLISHED reference values and against the two
// properties that are easy to get wrong and impossible to see on a chart:
// look-ahead in the weekly/monthly grains, and missing data silently becoming zero.
//
//   npm run vet
//
// Reference values come from StockChart's worked RSI example, and from cases whose
// answer is fixed by arithmetic (a flat series, a series with a known population σ).
// Nothing here compares the code to itself.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'vet-'));
execFileSync('npx', [
  'tsc', 'lib/indicators.ts', 'lib/rotationPhase.ts', 'lib/tradingview.ts', 'lib/config.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck',
], { stdio: 'inherit' });
const I = await import(join(out, 'indicators.js'));
const Q = await import(join(out, 'rotationPhase.js'));
const TV = await import(join(out, 'tradingview.js'));
const CFG = await import(join(out, 'config.js'));

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${note ? ` — ${note}` : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

console.log('\nRSI 14 — StockCharts published worked example');
const c = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,
           46.28,46.00,46.03,46.41,46.22,45.64,46.21,46.25,45.71,46.45,45.78,45.35,44.03,44.18,
           44.22,44.57,43.42,42.66,43.13];
const rsi = I.computeRSI(c, 14);
[70.46,66.25,66.48,69.35,66.29,57.92,62.88,63.21,56.01,62.34,54.68,50.39,39.98,41.46,41.87,45.46,37.30,33.09,37.79]
  .forEach((want, k) => ok(`bar ${14 + k}`, near(rsi[14 + k], want, 0.15), `${rsi[14 + k]?.toFixed(2)} vs ${want}`));
ok('null before the period is complete', rsi[13] === null);

console.log('\nMoving averages');
const lin = [1,2,3,4,5,6,7,8,9,10];
ok('SMA 3 on a ramp equals the middle value', near(I.computeSMA(lin,3)[2], 2, 1e-9) && near(I.computeSMA(lin,3)[9], 9, 1e-9));
ok('SMA null until the window fills', I.computeSMA(lin,3)[1] === null);
const ema = I.computeEMA(lin, 3);
ok('EMA seeded with the SMA', near(ema[2], 2, 1e-9));
ok('EMA tracks a ramp exactly (k=0.5)', near(ema[3], 3, 1e-9) && near(ema[4], 4, 1e-9));

console.log('\nBollinger — population sigma, as StockCharts defines it');
const bb = I.computeBollingerBands([2,4,4,4,5,5,7,9], 8, 2);
ok('middle = mean 5', near(bb.middle[7], 5, 1e-9));
ok('±2σ = 9 / 1 (σ=2 population)', near(bb.upper[7], 9, 1e-9) && near(bb.lower[7], 1, 1e-9));

console.log('\nMomentum (rate of change)');
ok('1 → 2 is +100%', near(I.computeMomentum([1,2],1)[1], 100, 1e-9));
ok('100 → 110 over 5 bars is +10%', near(I.computeMomentum([100,0,0,0,0,110],5)[5], 10, 1e-9));

console.log('\nMACD');
const noisy = Array.from({length:200},(_,i)=>100+10*Math.sin(i/7)+i*0.15);
const m = I.computeMACD(noisy,12,26,9);
let maxErr = 0, firstHist = -1;
for (let i=0;i<noisy.length;i++) if (m.hist[i]!=null) {
  if (firstHist<0) firstHist=i;
  maxErr = Math.max(maxErr, Math.abs(m.hist[i] - (m.macd[i] - m.signal[i])));
}
ok('histogram equals macd − signal everywhere', maxErr < 1e-12);
ok('macd starts at bar 25 (slow EMA 26)', m.macd[24] === null && m.macd[25] !== null);
ok('histogram starts at bar 33 (+ signal 9)', firstHist === 33);

console.log('\nWeekly resampling — and the look-ahead it could hide');
const dates = ['2024-01-01','2024-01-02','2024-01-03','2024-01-04','2024-01-05','2024-01-08','2024-01-09','2024-01-10'];
const w = I.resampleWeekly(dates, [10,11,12,13,14,20,21,22]);
ok('one bucket per calendar week', w.dates.length === 2);
ok("week's value is its LAST close, dated on that day", w.closes[0] === 14 && w.dates[0] === '2024-01-05');
const d200 = Array.from({length:200},(_,i)=>new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10));
const wr = I.computeRsiResampledDaily(d200, Array.from({length:200},(_,i)=>100+Math.sin(i/3)*5+i*0.2), 'weekly', 14);
const first = wr.findIndex(v => v != null);
ok('a weekly value never appears before its week has closed',
   new Date(d200[first] + 'T00:00:00Z').getUTCDay() === 0, d200[first]);
ok('it is then held forward, not recomputed each day',
   wr.slice(first, first + 7).every(v => v === wr[first]));

console.log('\n200-week SMA');
const mkWeeks = n => Array.from({length:n},(_,i)=>new Date(Date.UTC(2010,0,1+i*7)).toISOString().slice(0,10));
ok('null with 199 weekly closes', I.computeSma200wDaily(mkWeeks(199), Array(199).fill(50)).every(v => v === null));
ok('present at exactly 200', I.computeSma200wDaily(mkWeeks(200), Array(200).fill(50))[199] === 50);

console.log('\nVolume aggregation');
const rows = [
  { date:'2024-01-01', close:10, volume:1 }, { date:'2024-01-02', close:11, volume:2 },
  { date:'2024-01-03', close:12, volume:3 }, { date:'2024-01-04', close:13, volume:4 },
  { date:'2024-01-05', close:14, volume:5 }, { date:'2024-01-08', close:13, volume:6 },
  { date:'2024-01-09', close:12, volume:7 }, { date:'2024-01-10', close:11, volume:8 },
];
const wkv = I.aggregateVolume(rows, 'weekly').filter(d => d.volume != null);
ok('weekly volume is a SUM, on the week-end bar', wkv.length === 2 && wkv[0].volume === 15 && wkv[1].volume === 21);
ok('period colour compares period closes (14 → 11 = down)', wkv[0].up === true && wkv[1].up === false);
const mov = I.aggregateVolume(rows, 'monthly').filter(d => d.volume != null);
ok('monthly volume sums the month', mov.length === 1 && mov[0].volume === 36);
const gappy = [{ date:'2024-02-05', close:10, volume:3 }, { date:'2024-02-06', close:11 }, { date:'2024-02-07', close:12, volume:4 }];
ok('a day with no volume is skipped, not counted as zero',
   I.aggregateVolume(gappy,'weekly').filter(d=>d.volume!=null)[0].volume === 7);
ok('and stays null on the daily grain', I.aggregateVolume(gappy,'daily')[1].volume === null);

console.log('\nCycle-shape indicators');
// A flat series has zero volatility, so stretch is undefined rather than infinite.
ok('stretch is null when volatility is zero', I.computeStretchSigma(Array(300).fill(100))[299] === null);
// Ramp + noise: price above a rising 200-SMA must give positive stretch, and the
// slope of that average must be positive too.
const ramp = Array.from({length: 400}, (_, i) => 100 + i * 0.5 + (i % 7) * 0.4);
const st = I.computeStretchSigma(ramp);
ok('stretch positive on an uptrend above its average', st[399] > 0, `${st[399].toFixed(2)}σ`);
ok('stretch null before 200 bars exist', I.computeStretchSigma(ramp)[198] === null);
const sl = I.computeMaSlope(ramp, 200, 21);
ok('MA slope positive on a rising average', sl[399] > 0, `${sl[399].toFixed(2)}%/mo`);
ok('MA slope null before the average plus the span', sl[210] === null && sl[221] !== null);
// A series that falls for its whole second half must end below its average.
const hump = [...Array.from({length: 250}, (_, i) => 100 + i), ...Array.from({length: 250}, (_, i) => 350 - i * 1.2)];
ok('stretch negative after a sustained fall', I.computeStretchSigma(hump)[499] < 0, `${I.computeStretchSigma(hump)[499].toFixed(2)}σ`);
ok('MA slope turns negative after a sustained fall', I.computeMaSlope(hump, 200, 21)[499] < 0);
// Regime months: sign says which side, magnitude how long.
const reg = I.computeRegimeMonths(ramp, 200, 1.4);
ok('regime months positive while above the average', reg[399] > 0, `${reg[399].toFixed(1)} months`);
ok('regime months negative while below', I.computeRegimeMonths(hump, 200, 1.4)[499] < 0);
// Drawdown: 0 at a new high, exactly −20% twenty per cent below it. (Both of these
// caught errors in the TEST first — the ramp above ends on a sawtooth trough, and
// 20% below 359 is 287.2, not 288. Which is the point of writing them down.)
const strict = Array.from({length: 300}, (_, i) => 100 + i);
ok('drawdown is 0 at a new high', Math.abs(I.computeDrawdown(strict, 252)[299]) < 1e-9);
const dd = I.computeDrawdown([...strict, 399 * 0.8], 252);
ok('drawdown is −20% at 20% below the high', near(dd[dd.length - 1], -20, 1e-9), `${dd[dd.length-1]?.toFixed(6)}%`);
// Months since high: a high 3 months back reads ~3.
const d400 = Array.from({length: 400}, (_, i) => new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10));
const peaked = Array.from({length: 400}, (_, i) => (i <= 299 ? 100 + i : 399 - (i - 299)));
const msh = I.computeMonthsSinceHigh(d400, peaked, 252);
ok('months since the high ≈ elapsed months', near(msh[399], (400 - 300) / 30.44, 0.05), `${msh[399].toFixed(2)}`);

console.log('\nQuadrant position — the macro decides the pair, the leg decides which');
// Argument order is (X = distance from the 200-day average, Y = the leg).
ok('above the average, advancing → Trending',    Q.quadrantPosition(5, 3).phase === 'Trending');
ok('above the average, giving back → Recovering', Q.quadrantPosition(5, -3).phase === 'Recovering');
ok('below the average, advancing → Fading',      Q.quadrantPosition(-5, 3).phase === 'Fading');
ok('below the average, giving back → Lagging',   Q.quadrantPosition(-5, -3).phase === 'Lagging');
ok('a still leg continues the pair',
   Q.quadrantPosition(5, 0).phase === 'Trending' && Q.quadrantPosition(-5, 0).phase === 'Lagging');
ok('radius is hypot(x, y)', near(Q.quadrantPosition(4, 3).radius, 5, 1e-9));
const small = Q.quadrantPosition(0.4, 0.3), big = Q.quadrantPosition(4, 3);
ok('a bigger swing sits further out', near(big.radius, small.radius * 10, 1e-9),
   `${small.radius.toFixed(2)} vs ${big.radius.toFixed(2)}%`);
ok('null when either coordinate is unknown', Q.quadrantPosition(null, 5) === null && Q.quadrantPosition(1, null) === null);

console.log('\nQuadrant axes from a price history — answers fixed by arithmetic');
const mkSeries = (n, f) => Array.from({ length: n }, (_, i) => ({
  // Weekdays only, so the bars-per-month scaling sees an equity-like calendar.
  date: new Date(Date.UTC(2016, 0, 4) + Math.floor(i / 5) * 7 * 86400000 + (i % 5) * 86400000).toISOString().slice(0, 10),
  close: f(i),
}));
// A price that only ever rises is above its own average by half the average's lag, and
// never reverses, so the leg is the whole gain.
const steady = mkSeries(900, i => 100 * Math.pow(1.0008, i));
const axSteady = Q.trendAxes(steady);
ok('a constant riser is above its average', axSteady.macroGap > 0, `${axSteady.macroGap.toFixed(2)}%`);
ok('a constant riser is advancing', axSteady.momentum > 0, `+${axSteady.momentum.toFixed(1)}%`);
ok('the leg measures the whole rise', near(axSteady.momentum, (Math.pow(1.0008, 899) - 1) * 100, 0.5));
ok('a constant riser is Trending', Q.classifyPhase(axSteady.macroGap, axSteady.momentum) === 'Trending');
// A flat price is ON its average with no leg.
const flat = mkSeries(900, () => 100);
const axFlat = Q.trendAxes(flat);
ok('a flat price sits on its average', near(axFlat.macroGap, 0, 1e-9), `${axFlat.macroGap.toFixed(9)}`);
ok('a flat price has a zero leg', near(axFlat.momentum, 0, 1e-9));
// THE CASE THAT DROVE THIS DESIGN: a long decline, then a 10% rally. The rally is real —
// the leg has turned up — but the price is still under its 200-day average, so it is a
// rally inside a downtrend, and the only honest label for it is Fading. Read off the
// price's own recent range instead, this came out as Recovering or even Trending, which
// is how the NASDAQ 100 got called Trending through 22% of 2022.
const rallyInABear = mkSeries(1200, i => {
  if (i <= 600) return 100;
  if (i <= 1130) return 100 * Math.pow(0.9975, i - 600);
  return 100 * Math.pow(0.9975, 530) * (1 + 0.10 * (i - 1130) / 69);
});
const axRally = Q.trendAxes(rallyInABear);
ok('a rally inside a downtrend is Fading',
   Q.classifyPhase(axRally.macroGap, axRally.momentum) === 'Fading',
   `macro ${axRally.macroGap.toFixed(2)}%, leg +${axRally.momentum.toFixed(1)}%`);
// And its mirror: a dip inside an uptrend is Recovering, not Lagging.
const dipInABull = mkSeries(1200, i => {
  if (i <= 1130) return 100 * Math.pow(1.003, i);          // a steep enough uptrend that
  return 100 * Math.pow(1.003, 1130) * (1 - 0.08 * (i - 1130) / 69);   // the dip stays above
});
const axDip = Q.trendAxes(dipInABull);
ok('a dip inside an uptrend is Recovering',
   Q.classifyPhase(axDip.macroGap, axDip.momentum) === 'Recovering',
   `macro +${axDip.macroGap.toFixed(2)}%, leg ${axDip.momentum.toFixed(1)}%`);
// A steady fall is below its average and still giving ground.
const falling = mkSeries(900, i => 100 * Math.pow(0.999, i));
const axFall = Q.trendAxes(falling);
ok('a steady fall is Lagging', Q.classifyPhase(axFall.macroGap, axFall.momentum) === 'Lagging',
   `macro ${axFall.macroGap.toFixed(2)}%, leg ${axFall.momentum.toFixed(1)}%`);
// The reversal threshold scales with the asset's own volatility: the SAME 5% fall ends a
// leg on a calm series and does not on a wild one, with no per-asset tuning.
const churn = (amp) => mkSeries(880, i => {
  const base = 100 * (1 + amp * (i % 2 ? 1 : -1));
  return i < 872 ? base : base * (1 - 0.05 * (i - 871) / 8);
});
ok('a 5% fall ends a calm asset\'s leg', Q.trendAxes(churn(0.0015)).momentum < 0);
ok('the same fall does not end a volatile one\'s', Q.trendAxes(churn(0.015)).momentum >= 0);

// The whole-series pass and the single-date one must agree BAR FOR BAR: the panel draws
// from the first, the rotation table reads the second.
{
  const series = Q.trendAxesSeries(steady);
  let worst = 0, checked = 0;
  for (let i = 700; i < steady.length; i += 37) {
    const one = Q.trendAxes(steady, steady[i].date);
    if (!one || !series[i]) continue;
    worst = Math.max(worst, Math.abs(one.macroGap - series[i].macroGap), Math.abs(one.momentum - series[i].momentum));
    checked++;
  }
  ok('the one-pass series matches the per-date answer', checked > 3 && worst < 1e-9,
     `${checked} dates, worst difference ${worst.toExponential(1)}`);
  const bearSeries = Q.trendAxesSeries(rallyInABear);
  const bearOne = Q.trendAxes(rallyInABear, rallyInABear[rallyInABear.length - 1].date);
  ok('…through a decline and its rally too',
     bearSeries[bearSeries.length - 1] != null && bearOne != null
     && Math.abs(bearSeries[bearSeries.length - 1].macroGap - bearOne.macroGap) < 1e-9);
}

// Too little history is null, not a number computed from whatever is there.
ok('null below the average\'s own span', Q.trendAxes(mkSeries(Math.round(Q.MACRO_SPAN * 0.9), i => 100 + i)) === null);
ok('a number above it', Q.trendAxes(mkSeries(Math.round(Q.MACRO_SPAN * 1.4), i => 100 + i)) != null);
ok('null on an empty history', Q.trendAxes([]) === null && Q.trendAxes(undefined) === null);
// As-of dates never read forward.
const cut = steady[700].date;
const asOf = Q.trendAxes(steady, cut), truncated = Q.trendAxes(steady.slice(0, 701));
ok('as-of reads no forward data',
   near(asOf.macroGap, truncated.macroGap, 1e-12) && near(asOf.momentum, truncated.momentum, 1e-12));

console.log('\nTradingView links — every configured asset must map, and map correctly');
// Coverage: an asset added to config.ts with no mapping loses its button silently,
// which is exactly the kind of regression nobody notices until they need the link.
for (const [group, syms] of [
  ['Indexes', CFG.INDEXES.map(i => i.symbol)],
  ['Commodities', CFG.COMMODITIES.map(i => i.symbol)],
  ['Sectors', CFG.SECTORS.map(i => i.symbol)],
  ['Crypto', Object.values(CFG.CRYPTO_YAHOO_SYMBOLS)],
  ['Currencies', CFG.CURRENCY_PAIRS.map(p => p.symbol)],
]) {
  const missing = syms.filter(s => !TV.tradingViewSymbol(s, group));
  ok(`${group}: all ${syms.length} map`, missing.length === 0, missing.join(', '));
}
// Correctness on the cases where a wrong answer opens a real chart of the wrong thing.
ok('^GSPC is the S&P index, not a ticker called GSPC', TV.tradingViewSymbol('^GSPC') === 'TVC:SPX');
ok('SI=F is silver futures, not the company SI', TV.tradingViewSymbol('SI=F') === 'COMEX:SI1!');
ok('GC=F is gold futures', TV.tradingViewSymbol('GC=F') === 'COMEX:GC1!');
ok('BTC-USD is the crypto index', TV.tradingViewSymbol('BTC-USD') === 'CRYPTO:BTCUSD');
ok('JPY=X means USD/JPY', TV.tradingViewSymbol('JPY=X') === 'FX_IDC:USDJPY');
ok('EURUSD=X is the pair as written', TV.tradingViewSymbol('EURUSD=X') === 'FX_IDC:EURUSD');
// The app charts some pairs the opposite way round from the market's convention, and a
// broker feed does not carry those at all — the indicative feed does, in both directions.
ok('an inverted major keeps its direction', TV.tradingViewSymbol('USDGBP=X') === 'FX_IDC:USDGBP');
ok('an emerging cross is covered', TV.tradingViewSymbol('EURBRL=X') === 'FX_IDC:EURBRL');
ok('a London listing keeps its venue', TV.tradingViewSymbol('EIMI.L') === 'LSE:EIMI');
ok('a plain US ticker is passed through', TV.tradingViewSymbol('MU') === 'MU');
// TVC has no KOSPI — asking for it made the embed draw Apple. The table is only ever a
// candidate now (/api/tv-symbol verifies it), but a known-dead entry has no business
// being the candidate.
ok('KOSPI is on KRX, not TVC', TV.tradingViewSymbol('^KS11') === 'KRX:KOSPI');
ok('an unmappable symbol yields no link',
   TV.tradingViewSymbol('^UNKNOWNIDX') === null && TV.tradingViewUrl('^UNKNOWNIDX') === null);
ok('the URL carries the encoded symbol',
   TV.tradingViewUrl('^GSPC') === 'https://www.tradingview.com/chart/?symbol=TVC%3ASPX');

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
