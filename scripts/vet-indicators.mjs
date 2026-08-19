// Check the indicators against PUBLISHED reference values and against the two
// properties that are easy to get wrong and impossible to see on a chart:
// look-ahead in the weekly/monthly grains, and missing data silently becoming zero.
//
//   npm run vet
//
// Reference values come from StockChart's worked RSI example, and from cases whose
// answer is fixed by arithmetic (a flat series, a series with a known population σ).
//
// A check that only restates the implementation proves nothing: "the histogram equals
// macd minus signal" is true by construction and cannot fail however wrong the two EMAs
// are. So the indicators are also pinned to their CLOSED FORMS on inputs where algebra
// gives the answer — an exponential average lags a straight line by exactly s·(n−1)/2,
// so MACD on any ramp is exactly 7·slope and its histogram is exactly zero. Those catch
// a wrong smoothing constant, a wrong seed or an off-by-one in a span; the identity
// check cannot.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'vet-'));
execFileSync('npx', [
  'tsc', 'lib/indicators.ts', 'lib/rotationPhase.ts', 'lib/tradingview.ts', 'lib/config.ts',
  'lib/volatility.ts', 'lib/phaseRuns.ts', 'lib/macroDerived.ts', 'lib/eventCalendar.ts', 'lib/eventCalendarData.ts', 'lib/gistMerge.ts', 'lib/windows.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck',
], { stdio: 'inherit' });
// tsc emits the module specifiers exactly as written, and TypeScript writes them without
// an extension. Node's ESM loader will not resolve those, so the one file here that
// imports another (eventCalendar → config) fails at load. Adding the extension in the
// emitted copy keeps the SOURCE written the way the rest of the app writes it.
for (const f of readdirSync(out).filter(n => n.endsWith('.js'))) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\/[^']+?)'/g, (m, spec) =>
    spec.endsWith('.js') ? m : `from '${spec}.js'`));
}
const I = await import(join(out, 'indicators.js'));
const Q = await import(join(out, 'rotationPhase.js'));
const TV = await import(join(out, 'tradingview.js'));
const CFG = await import(join(out, 'config.js'));
const V = await import(join(out, 'volatility.js'));
const R = await import(join(out, 'phaseRuns.js'));
const D = await import(join(out, 'macroDerived.js'));
const EC = await import(join(out, 'eventCalendar.js'));
const ED = await import(join(out, 'eventCalendarData.js'));
const GM = await import(join(out, 'gistMerge.js'));

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

// ── Analytic identities ─────────────────────────────────────────────────────
// The checks above this point are either published reference values (RSI, Bollinger) or
// they compare the code to itself — "the histogram equals macd minus signal" is TRUE BY
// CONSTRUCTION and cannot fail however wrong the EMAs are. These are the independent
// ones: on a straight-line price the answers are fixed by algebra, so a wrong smoothing
// constant, a wrong seed or an off-by-one in the span all show up here.
console.log('\nEMA and MACD against their closed forms on a straight line');
{
  // For x(t) = a + s·t the exponential average settles at x(t) − s·(n−1)/2: it lags the
  // price by half the span, exactly. Derived from k = 2/(n+1), not from this code.
  const SLOPE = 0.7;
  const line = Array.from({ length: 400 }, (_, i) => 50 + SLOPE * i);
  for (const n of [12, 20, 26, 50]) {
    const e = I.computeEMA(line, n);
    const want = line[399] - SLOPE * (n - 1) / 2;
    ok(`EMA ${n} lags a ramp by s·(n−1)/2`, near(e[399], want, 1e-6),
       `${e[399].toFixed(4)} vs ${want.toFixed(4)}`);
  }
  // Therefore MACD = EMA12 − EMA26 = s·(26−12)/2 = 7s, the signal line settles on the
  // same constant, and the histogram is zero. A trend of any slope, no matter how steep,
  // has a FLAT histogram — which is the whole reason the histogram means acceleration.
  const m = I.computeMACD(line, 12, 26, 9);
  ok('MACD on a ramp equals 7·slope', near(m.macd[399], 7 * SLOPE, 1e-6),
     `${m.macd[399].toFixed(4)} vs ${(7 * SLOPE).toFixed(4)}`);
  ok('…its signal settles on the same value', near(m.signal[399], 7 * SLOPE, 1e-6));
  ok('…so a steady trend has a flat histogram', near(m.hist[399], 0, 1e-6),
     `${m.hist[399].toExponential(1)}`);
  // Sanity in the other direction: a DECELERATING rise must show a negative histogram
  // and an accelerating one a positive one. This is what the pane is read for.
  const accel = Array.from({ length: 400 }, (_, i) => 50 + 0.002 * i * i);
  const decel = Array.from({ length: 400 }, (_, i) => 50 + 40 * Math.sqrt(i));
  ok('an accelerating rise has a positive histogram', I.computeMACD(accel).hist[399] > 0);
  ok('a decelerating rise has a negative histogram', I.computeMACD(decel).hist[399] < 0);
  // A flat price: every average equals it, MACD is zero.
  const flatLine = Array(300).fill(123.45);
  ok('EMA of a constant is that constant', near(I.computeEMA(flatLine, 26)[299], 123.45, 1e-9));
  ok('MACD of a constant is zero', near(I.computeMACD(flatLine).macd[299], 0, 1e-9));
}

console.log('\nRSI, momentum and drawdown at their limits');
{
  const up = Array.from({ length: 200 }, (_, i) => 10 + i);
  const down = Array.from({ length: 200 }, (_, i) => 300 - i);
  // Wilder's RSI is 100·gain/(gain+loss). With no losses it is exactly 100, with no
  // gains exactly 0 — the two values the formula can only reach at its limits.
  ok('RSI of a series that only rises is 100', near(I.computeRSI(up)[199], 100, 1e-9));
  ok('RSI of a series that only falls is 0', near(I.computeRSI(down)[199], 0, 1e-9));
  // RSI = 50 when the smoothed gain equals the smoothed loss. That needs the two to be
  // ALTERNATING, not a rise followed by an equal fall: Wilder's average decays at 1/14 a
  // bar, so a hundred falling bars leave the earlier rise weighted (13/14)^100 ≈ 0.0007
  // and the answer is 0, not 50. Written the wrong way round the first time — the check
  // failed and the code was right.
  //
  // And it is the PAIR that centres on 50, not each bar: Wilder gives the newest move a
  // full 1/14 weight, so on a +1 bar the reading is 51.8519 and on the −1 bar that
  // follows it is 48.1481. They sum to 100 to nine decimals. Asserting 50 on a single
  // bar failed too — the second wrong expectation in this block, and again the code was
  // right. A test that keeps failing against correct code is a test worth reading twice.
  const zigzag = Array.from({ length: 300 }, (_, i) => 100 + (i % 2));
  const rz = I.computeRSI(zigzag);
  ok('…and a consecutive pair straddles 50 exactly', near(rz[299] + rz[298], 100, 1e-6),
     `${rz[298].toFixed(4)} and ${rz[299].toFixed(4)}`);
  // Drawdown: a peak of 200 down to 150 is exactly −25%. (The first version of this
  // check built a series peaking at 199 and asserted −25% — again the check was wrong
  // and the code was right, at −24.62%.)
  const peaked = [...Array.from({ length: 100 }, (_, i) => 101 + i), 150];
  ok('drawdown is exact', near(I.computeDrawdown(peaked, 252)[100], -25, 1e-9),
     `${I.computeDrawdown(peaked, 252)[100].toFixed(6)}%`);
  ok('drawdown is 0 while making new highs', near(I.computeDrawdown(up, 252)[199], 0, 1e-12));
  // Momentum over n bars is the plain percentage change over n bars, nothing smoothed.
  ok('momentum matches the raw change', near(I.computeMomentum(up, 10)[199], (209 / 199 - 1) * 100, 1e-9));
}

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

console.log('\nQuadrant position — depth decides the half, the leg decides which of the two');
// Argument order is (X = how deep the cycle has gone in σ-months, Y = the leg in σ).
ok('shallow, rising → Trending',   Q.quadrantPosition(-0.5, 3).phase === 'Trending');
ok('shallow, falling → Fading',    Q.quadrantPosition(-0.5, -1.5).phase === 'Fading');
ok('deep, falling → Lagging',      Q.quadrantPosition(-4, -4).phase === 'Lagging');
ok('deep, rising → Recovering',    Q.quadrantPosition(-4, 1.5).phase === 'Recovering');
// The boundary belongs to the severe side: a fall that has just reached SEVERE_SIGMA IS
// the correction, not a pause that might still be one.
ok('the severity boundary is inclusive',
   Q.quadrantPosition(-Q.SEVERE_SIGMA, -1).phase === 'Lagging'
   && Q.quadrantPosition(-Q.SEVERE_SIGMA + 1e-9, -1).phase === 'Fading');
// Recovering is unreachable while the cycle is shallow — that is what stops a dip inside
// a rise being called a bottom, which is the whole reason this model exists.
ok('a shallow rise is never Recovering', Q.quadrantPosition(-1.9, 5).phase === 'Trending');
ok('radius is hypot(x, y)', near(Q.quadrantPosition(-4, 3).radius, 5, 1e-9));
const small = Q.quadrantPosition(-0.4, 0.3), big = Q.quadrantPosition(-4, 3);
ok('a bigger swing sits further out', near(big.radius, small.radius * 10, 1e-9),
   `${small.radius.toFixed(2)} vs ${big.radius.toFixed(2)}σ`);
ok('null when either coordinate is unknown', Q.quadrantPosition(null, 5) === null && Q.quadrantPosition(1, null) === null);

console.log('\nQuadrant axes from a price history — answers fixed by arithmetic');
const mkSeries = (n, f) => Array.from({ length: n }, (_, i) => ({
  // Weekdays only, so the bars-per-month scaling sees an equity-like calendar.
  date: new Date(Date.UTC(2016, 0, 4) + Math.floor(i / 5) * 7 * 86400000 + (i % 5) * 86400000).toISOString().slice(0, 10),
  close: f(i),
}));
// A price that only ever rises never gives anything back, so the cycle has no depth and
// the leg is the whole gain.
const steady = mkSeries(900, i => 100 * Math.pow(1.0008, i));
const axSteady = Q.trendAxes(steady);
ok('a constant riser has an undamaged cycle', near(axSteady.macroGap, 0, 1e-6), `${axSteady.macroGap.toFixed(6)}σ`);
ok('a constant riser is advancing', axSteady.momentum > 0, `+${axSteady.momentum.toFixed(1)}σ`);
ok('a constant riser is Trending', Q.classifyPhase(axSteady.macroGap, axSteady.momentum) === 'Trending');
// A flat price has neither depth nor a leg. It seeds Trending because it is not below its
// own average, and nothing ever moves it out.
const flat = mkSeries(900, () => 100);
const axFlat = Q.trendAxes(flat);
ok('a flat price has no cycle depth', near(axFlat.macroGap, 0, 1e-5), `${axFlat.macroGap.toFixed(9)}`);
ok('a flat price has no leg', near(axFlat.momentum, 0, 1e-5));

// THE CASE THAT DROVE THIS VERSION: the user's own. A long rise, then a fall of a few
// monthly volatilities, then a recovery. The descent must read Fading and then Lagging —
// NOT Recovering, which is what a 200-day-average gate produced for the whole way down.
const dipInABull = mkSeries(1200, i => {
  if (i <= 1100) return 100 * Math.pow(1.0015, i);
  if (i <= 1140) return 100 * Math.pow(1.0015, 1100) * (1 - 0.09 * (i - 1100) / 40); // the fall
  return 100 * Math.pow(1.0015, 1100) * 0.91 * (1 + 0.04 * (i - 1140) / 60);          // off the low
});
const phaseAt = (series, i) => {
  const ax = Q.trendAxesSeries(series);
  return ax[i] ? Q.classifyPhase(ax[i].macroGap, ax[i].momentum) : null;
};
ok('a rise before the fall is Trending', phaseAt(dipInABull, 1090) === 'Trending');
ok('the descent is not Recovering',
   ['Fading', 'Lagging'].includes(phaseAt(dipInABull, 1130)), `${phaseAt(dipInABull, 1130)}`);
ok('the deep part of the descent is Lagging', phaseAt(dipInABull, 1139) === 'Lagging');
// Recovering is reachable ONLY out of Lagging: walk the whole series and check no
// Recovering day is ever preceded by a Trending or Fading one.
{
  const ax = Q.trendAxesSeries(dipInABull).map(a => (a ? Q.classifyPhase(a.macroGap, a.momentum) : null));
  let bad = null;
  for (let i = 1; i < ax.length; i++)
    if (ax[i] === 'Recovering' && ax[i - 1] && ax[i - 1] !== 'Recovering' && ax[i - 1] !== 'Lagging') bad = i;
  ok('Recovering is entered only from Lagging', bad === null, bad ? `at bar ${bad}` : '');
}
// THE GOLD CASE. A long parabolic rise, then a deep fall. The 200-day average is still
// RISING for months into that fall — it is catching up to the old rally — so a gate that
// only asks "has the slow average stopped falling" stands wide open through the whole
// collapse. On real gold that produced Recovering on 18% of a year at −3.6% a stretch.
// Nothing may be called Recovering while the price is under its own faster average.
{
  const parabola = mkSeries(1500, i => (i <= 1200
    ? 100 * Math.pow(1.0022, i)                                   // three years of rise
    : 100 * Math.pow(1.0022, 1200) * Math.pow(0.9975, i - 1200))); // then a long fall
  const ax = Q.trendAxesSeries(parabola);
  const lab = ax.map(a => (a ? Q.classifyPhase(a.macroGap, a.momentum) : null));
  // The slow average must genuinely still be rising well into the fall, or the case is
  // not the one being guarded against and the test proves nothing.
  const closes = parabola.map(p => p.close);
  const slowAt = k => closes.slice(k - Q.MACRO_SPAN + 1, k + 1).reduce((s, v) => s + v, 0) / Q.MACRO_SPAN;
  ok('the 200-day average is still rising 60 days into the fall', slowAt(1260) > slowAt(1239),
     `${slowAt(1239).toFixed(1)} → ${slowAt(1260).toFixed(1)}`);
  const fastAt = k => closes.slice(k - Q.RECLAIM_SPAN + 1, k + 1).reduce((s, v) => s + v, 0) / Q.RECLAIM_SPAN;
  let called = null;
  for (let i = 1230; i < 1500; i++) if (lab[i] === 'Recovering' && closes[i] < fastAt(i)) called = i;
  ok('no bottom is called while the price is under its 50-day average', called === null,
     called ? `at bar ${called}` : '');
  ok('the fall itself reads Lagging',
     lab.slice(1300, 1490).filter(p => p === 'Lagging').length > 150,
     `${lab.slice(1300, 1490).filter(p => p === 'Lagging').length} of 190 days`);
}

// The revised view: it may only ever turn Lagging into Recovering, only on bars BEFORE
// the confirmation, and it must never touch the last bar — the live call. That last part
// is what keeps the rotation table and the badges honest while the chart reads as a cycle.
{
  const cyc = mkSeries(1400, i => (i <= 900 ? 100 * Math.pow(1.0015, i)
    : i <= 1050 ? 100 * Math.pow(1.0015, 900) * Math.pow(0.995, i - 900)
    : 100 * Math.pow(1.0015, 900) * Math.pow(0.995, 150) * Math.pow(1.004, i - 1050)));
  const live = Q.trendAxesSeries(cyc);
  const drawn = Q.trendAxesSeries(cyc, { revised: true });
  const ph = a => (a ? Q.classifyPhase(a.macroGap, a.momentum) : null);
  let changed = 0, illegal = 0;
  for (let i = 0; i < cyc.length; i++) {
    const a = ph(live[i]), b = ph(drawn[i]);
    if (a === b) continue;
    changed++;
    if (!(a === 'Lagging' && b === 'Recovering')) illegal++;
  }
  ok('the redraw moves some bars', changed > 5, `${changed} bars`);
  ok('…and only ever Lagging → Recovering', illegal === 0, `${illegal} illegal`);
  ok('…and flags every one it moved',
     drawn.filter((a, i) => a && ph(a) !== ph(live[i])).every(a => a.revised === true));
  ok('…and flags nothing it did not', drawn.filter((a, i) => a?.revised && ph(a) === ph(live[i])).length === 0);
  const last = cyc.length - 1;
  ok('the last bar is never redrawn — the live call is untouched',
     ph(drawn[last]) === ph(live[last]) && !drawn[last]?.revised);
  // trendAxes() is the live answer and must ignore the option entirely.
  const asOf = Q.trendAxes(cyc, cyc[1100].date);
  ok('the as-of answer matches the unrevised series', asOf != null
     && Math.abs(asOf.macroGap - live[1100].macroGap) < 1e-9
     && Math.abs(asOf.momentum - live[1100].momentum) < 1e-9);
  ok('the default is the live view', Q.trendAxesSeries(cyc).every((a, i) => ph(a) === ph(live[i])));
}

// A steady fall is the correction itself.
const falling = mkSeries(900, i => 100 * Math.pow(0.999, i));
const axFall = Q.trendAxes(falling);
ok('a steady fall is Lagging', Q.classifyPhase(axFall.macroGap, axFall.momentum) === 'Lagging',
   `depth ${axFall.macroGap.toFixed(2)}σ, leg ${axFall.momentum.toFixed(1)}σ`);
// Every point must sit in the quadrant its own label names — the clamp that makes the
// chart readable. Unclamped this is 93–97%, and the misses are exactly the near-zero
// cases that look like a dot in the wrong colour.
for (const [name, series] of [['a bull with a dip', dipInABull], ['a steady fall', falling], ['a riser', steady]]) {
  const ax = Q.trendAxesSeries(series);
  let mism = 0, n = 0;
  for (const a of ax) if (a) { n++; if (Q.quadrantPosition(a.macroGap, a.momentum).phase !== Q.classifyPhase(a.macroGap, a.momentum)) mism++; }
  ok(`${name}: every point matches its label`, n > 100 && mism === 0, `${mism} of ${n}`);
}
// The thresholds scale with the asset's own volatility: the SAME 5% fall is severe for a
// calm series and noise for a wild one, with no per-asset tuning.
const churn = (amp) => mkSeries(880, i => {
  const base = 100 * (1 + amp * (i % 2 ? 1 : -1));
  return i < 872 ? base : base * (1 - 0.05 * (i - 871) / 8);
});
ok('a 5% fall turns a calm asset\'s leg down', Q.trendAxes(churn(0.0015)).momentum < 0);
ok('the same fall does not turn a volatile one\'s', Q.trendAxes(churn(0.015)).momentum > 0);

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
  // …and through a full cycle, where the state machine has actually changed state: a
  // single-date answer that restarted the machine at a different bar would land in a
  // different phase entirely, not merely a few hundredths out.
  const cycSeries = Q.trendAxesSeries(dipInABull);
  let cycWorst = 0, cycChecked = 0;
  for (let i = 1050; i < dipInABull.length; i += 13) {
    const one = Q.trendAxes(dipInABull, dipInABull[i].date);
    if (!one || !cycSeries[i]) continue;
    cycWorst = Math.max(cycWorst, Math.abs(one.macroGap - cycSeries[i].macroGap), Math.abs(one.momentum - cycSeries[i].momentum));
    cycChecked++;
  }
  ok('…through a fall and the recovery after it', cycChecked > 5 && cycWorst < 1e-9,
     `${cycChecked} dates, worst difference ${cycWorst.toExponential(1)}`);
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

console.log('\nVolatility — the up/down split, answers fixed by arithmetic');
// Weekday bars, so the calendar scaling sees ~252 a year.
const volSeries = (n, f) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2016, 0, 4) + Math.floor(i / 5) * 7 * 86400000 + (i % 5) * 86400000).toISOString().slice(0, 10),
  close: f(i),
}));
{
  // The two parts must ADD UP to the headline — the whole reason the split is taken on
  // variance shares rather than as two semi-deviations, which combine in quadrature and
  // give a reader two numbers that visibly do not make the third.
  const mixed = volSeries(500, i => 100 * Math.pow(1.004, i % 2 ? 1 : -1) * Math.pow(1.0003, i));
  const v = V.computeVolatility(mixed);
  ok('up + down = total, exactly', near(v.up + v.down, v.total, 1e-9),
     `${v.up.toFixed(2)} + ${v.down.toFixed(2)} = ${(v.up + v.down).toFixed(2)} vs ${v.total.toFixed(2)}`);
  ok('all three are positive', v.total > 0 && v.up > 0 && v.down > 0);
  // Each side must be built from ITS OWN days: a series with one extra violent down day
  // must move `down` and leave `up` alone.
  const calmer = volSeries(500, i => 100 * Math.pow(1.004, i % 2 ? 1 : -1));
  const shocked = calmer.map((p, i) => (i >= 250 ? { ...p, close: p.close * 0.85 } : p));
  const c0 = V.computeVolatility(calmer), c1 = V.computeVolatility(shocked);
  ok('a one-off crash raises the down side', c1.down > c0.down * 1.4,
     `${c0.down.toFixed(2)}% → ${c1.down.toFixed(2)}%`);
  // It cannot leave the up side untouched: the two must sum to a total that the crash
  // genuinely raises, so both rise. What must hold is that the down side rises MORE and
  // that the balance tips downward — and, above all, that the up side is never LOWERED,
  // which is exactly what a variance-share split does and why this one uses magnitudes.
  ok('…more than it raises the up side', (c1.down - c0.down) > (c1.up - c0.up) * 1.25,
     `down +${(c1.down - c0.down).toFixed(2)} vs up +${(c1.up - c0.up).toFixed(2)}`);
  ok('…and never lowers the up side', c1.up >= c0.up, `${c0.up.toFixed(2)}% → ${c1.up.toFixed(2)}%`);
  ok('…and tips the balance downward', V.upShare(c1) < V.upShare(c0) - 1,
     `${V.upShare(c0).toFixed(1)}% → ${V.upShare(c1).toFixed(1)}% upside`);

  // A price that only ever rises contributes nothing to the downside, and vice versa.
  const onlyUp = volSeries(400, i => 100 * Math.pow(1.001, i));
  const onlyDown = volSeries(400, i => 100 * Math.pow(0.999, i));
  ok('a series that only rises has no downside vol', V.computeVolatility(onlyUp).down === 0);
  ok('…and its up equals its total', near(V.computeVolatility(onlyUp).up, V.computeVolatility(onlyUp).total, 1e-9));
  ok('a series that only falls has no upside vol', V.computeVolatility(onlyDown).up === 0);

  // A move of ±1% on alternate days: |r| = 1% exactly, so the annualised figure is
  // 1% × √(bars per year). This generator is weekdays with NO holidays, which is
  // 5 × 52.18 = 260.9 bars a year, not the 252 a real exchange trades — and the whole
  // point of measuring the calendar instead of hardcoding it is that it notices.
  const alt = volSeries(500, i => (i % 2 ? 100 : 100 * Math.exp(-0.01)));
  const a = V.computeVolatility(alt);
  ok('±1% alternating annualises to 1% × √(bars per year)',
     near(a.total, Math.sqrt(260.9), 0.2), `${a.total.toFixed(2)}% vs ${Math.sqrt(260.9).toFixed(2)}%`);
  ok('an evenly-split asset reads 50% upside', near(V.upShare(a), 50, 1.5), `${V.upShare(a).toFixed(1)}%`);
  ok('…and each half is half the total', near(a.up, a.total / 2, 0.2) && near(a.down, a.total / 2, 0.2),
     `${a.up.toFixed(2)} / ${a.down.toFixed(2)} of ${a.total.toFixed(2)}`);

  // The SAME daily moves on a 7-day calendar must annualise HIGHER, because there are
  // more of them in a year. A fixed √252 would rate crypto below an equity index for no
  // reason but the calendar.
  const everyDay = Array.from({ length: 500 }, (_, i) => ({
    date: new Date(Date.UTC(2016, 0, 4) + i * 86400000).toISOString().slice(0, 10),
    close: i % 2 ? 100 : 100 * Math.exp(-0.01),
  }));
  const e = V.computeVolatility(everyDay);
  ok('a 365-day calendar annualises higher than a weekday one', e.total > a.total * 1.15,
     `${e.total.toFixed(1)}% vs ${a.total.toFixed(1)}%`);
  ok('…by about √(365/261)', near(e.total / a.total, Math.sqrt(365.25 / 260.9), 0.05),
     `×${(e.total / a.total).toFixed(3)}`);

  // Too little history is null, not a number computed from three points.
  ok('null below 21 bars', V.computeVolatility(volSeries(15, () => 100)) === null);
  ok('null on nothing at all', V.computeVolatility([]) === null && V.computeVolatility(undefined) === null);
  // A flat price has no volatility at all, and that must not be null.
  const flatV = V.computeVolatility(volSeries(300, () => 100));
  ok('a flat price has zero volatility', flatV != null && flatV.total === 0 && flatV.up === 0);
  ok('…and no upside share to report', V.upShare(flatV) === null);

  // The bands the filter uses.
  ok('bands split at 15 and 30', V.volBand(14.9) === 'calm' && V.volBand(15) === 'normal'
     && V.volBand(30) === 'normal' && V.volBand(30.1) === 'wild');
  ok('an unknown volatility has no band', V.volBand(null) === null && V.volBand(NaN) === null);
}

console.log('\nSaved-data patching — the silent-drop bug');
{
  // THE BUG THIS REPLACED: the merge was a key-by-key allow-list, so a field nobody
  // remembered to add was dropped from the local cache while the server stored it fine.
  // Adding a personal calendar event did nothing on screen and the data was really there.
  const cur = { pins: ['AAPL'], notes: { a: [1] } };
  const out1 = GM.mergePatch(cur, { calendarEvents: [{ id: 'x' }] });
  ok('a key the merge has never heard of survives',
     out1.calendarEvents?.[0]?.id === 'x', JSON.stringify(out1.calendarEvents));
  ok('…and the existing keys are untouched', out1.pins[0] === 'AAPL' && out1.notes.a[0] === 1);

  // notes MERGE — a note saved against one chart must not wipe another chart's.
  const out2 = GM.mergePatch({ notes: { a: [1], b: [2] } }, { notes: { b: [9] } });
  ok('notes merge per chart', out2.notes.a[0] === 1 && out2.notes.b[0] === 9,
     JSON.stringify(out2.notes));

  // Everything else REPLACES: a pin list of two must not silently union with the old one,
  // or unpinning would never take effect.
  const out3 = GM.mergePatch({ pins: ['A', 'B', 'C'] }, { pins: ['A'] });
  ok('an array replaces rather than unions', out3.pins.length === 1 && out3.pins[0] === 'A',
     JSON.stringify(out3.pins));

  // undefined means "not in this patch", not "delete it".
  const out4 = GM.mergePatch({ pins: ['A'], analyses: [1] }, { pins: undefined, analyses: [2] });
  ok('an undefined field is left alone', out4.pins[0] === 'A' && out4.analyses[0] === 2);

  ok('an empty patch changes nothing', JSON.stringify(GM.mergePatch(cur, {})) === JSON.stringify(cur));
  ok('a key can be emptied deliberately', GM.mergePatch({ pins: ['A'] }, { pins: [] }).pins.length === 0);
}

console.log('\nForward calendar — the window, and the daylight-saving trap');
{
  // 2pm in New York is NOT a fixed UTC offset. September is EDT (UTC−4) and December is
  // EST (UTC−5), so the same wall-clock FOMC statement is 18:00Z then 19:00Z. Storing a
  // fixed offset gets one of the two wrong every single year.
  ok('2pm New York in September is 18:00Z',
     EC.zonedTimeToUtc('2026-09-16', 14, 0, 'America/New_York') === '2026-09-16T18:00:00.000Z',
     EC.zonedTimeToUtc('2026-09-16', 14, 0, 'America/New_York'));
  ok('…and in December it is 19:00Z',
     EC.zonedTimeToUtc('2026-12-09', 14, 0, 'America/New_York') === '2026-12-09T19:00:00.000Z',
     EC.zonedTimeToUtc('2026-12-09', 14, 0, 'America/New_York'));
  // The day either side of the US changeover, which is where a naive conversion breaks.
  ok('the day before the autumn changeover is still EDT',
     EC.zonedTimeToUtc('2026-10-31', 14, 0, 'America/New_York') === '2026-10-31T18:00:00.000Z');
  ok('…and the day after is EST',
     EC.zonedTimeToUtc('2026-11-02', 14, 0, 'America/New_York') === '2026-11-02T19:00:00.000Z');
  // Europe changes over on a different weekend from the US, so a zone that is normally
  // six hours from New York briefly is not — the reason both sides are resolved per date.
  ok('Rome is +2 in summer', EC.zonedTimeToUtc('2026-07-01', 14, 30, 'Europe/Rome') === '2026-07-01T12:30:00.000Z');
  ok('…and +1 in winter',    EC.zonedTimeToUtc('2026-01-15', 14, 30, 'Europe/Rome') === '2026-01-15T13:30:00.000Z');

  const now = new Date('2026-08-14T12:00:00Z');
  const ev = (id, date) => ({ id, title: id, category: 'geopolitical', region: 'G', flag: '🌍', date, timeKnown: false });
  const all = [
    ev('past', '2026-08-13T12:00:00Z'),
    ev('today', '2026-08-14T18:00:00Z'),
    ev('soon', '2026-09-16T18:00:00Z'),
    ev('edge-in', '2026-12-14T00:00:00Z'),
    ev('edge-out', '2027-03-01T00:00:00Z'),
  ];
  const win = EC.upcomingEvents(all, now, 6);
  ok('the window drops what has passed', !win.some(e => e.id === 'past'));
  ok('…keeps what is still ahead today', win.some(e => e.id === 'today'));
  ok('…keeps the far edge inside six months', win.some(e => e.id === 'edge-in'));
  ok('…and excludes what is beyond it', !win.some(e => e.id === 'edge-out'));
  ok('…sorted soonest first', win.map(e => e.id).join(',') === 'today,soon,edge-in', win.map(e => e.id).join(','));

  ok('countdown says today', EC.countdown('2026-08-14T20:00:00Z', now) === 'today');
  ok('…tomorrow', EC.countdown('2026-08-15T12:00:00Z', now) === 'tomorrow');
  ok('…days, then weeks, then months',
     EC.countdown('2026-08-19T12:00:00Z', now) === 'in 5 days'
     && EC.countdown('2026-09-04T12:00:00Z', now) === 'in 3 weeks'
     && EC.countdown('2026-12-09T12:00:00Z', now) === 'in 4 months',
     `${EC.countdown('2026-09-04T12:00:00Z', now)} / ${EC.countdown('2026-12-09T12:00:00Z', now)}`);

  // Grouping is by the day in the READER'S zone: an event at 23:00 UTC is already the
  // next day in Rome, and the card must sit under the date they would call it.
  const g = EC.groupByDay([ev('late', '2026-09-16T23:00:00Z')], 'Europe/Rome');
  ok('grouped by the day in the reader\'s zone', g[0].day === '2026-09-17', g[0].day);

  // ── EVERY BUNDLED INSTANT, against the wall-clock time it stands for ──
  //
  // The UTC offsets in the data file are written by hand and change mid-calendar: the
  // October FOMC is 18:00Z and the December one 19:00Z, the November CPI is 13:30Z and
  // the October one 12:30Z. One wrong hour is invisible on the page and wrong forever.
  // Each entry is reconstructed from its published local time and must match exactly.
  const WALL = [
    ['FOMC Rate Decision',            14, 0,  'America/New_York'],
    ['ECB Monetary Policy',           14, 15, 'Europe/Berlin'],
    ['Bank of England Rate Decision', 12, 0,  'Europe/London'],
    ['US CPI Inflation Report',       8,  30, 'America/New_York'],
    ['US Non-Farm Payrolls',          8,  30, 'America/New_York'],
  ];
  let checked = 0, wrong = [];
  for (const e of ED.CALENDAR_EVENTS) {
    const rule = WALL.find(([t]) => e.title.startsWith(t));
    if (!rule) continue;                       // BoJ publishes no fixed hour
    const [, h, mi, tz] = rule;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(e.date));
    const want = EC.zonedTimeToUtc(day, h, mi, tz);
    checked++;
    if (Date.parse(want) !== Date.parse(e.date)) wrong.push(`${e.title.slice(0, 18)} ${e.date} should be ${want}`);
  }
  ok(`every bundled release matches its published local time (${checked} checked)`,
     wrong.length === 0, wrong.slice(0, 3).join(' | '));

  // Payrolls are published on the first Friday of the month. Anything else is either a
  // typo or one of the genuine exceptions, and both are worth being told about.
  const notFriday = ED.CALENDAR_EVENTS.filter(e => e.title.startsWith('US Non-Farm'))
    .filter(e => new Date(e.date).getUTCDay() !== 5);
  ok('every payrolls date is a Friday', notFriday.length === 0, notFriday.map(e => e.date).join(', '));

  // Nothing bundled may be missing the fields the card renders.
  const bad = ED.BUNDLED_EVENTS.filter(e => !e.id || !e.title || !e.flag || !e.region || !isFinite(Date.parse(e.date)));
  ok('every bundled event is complete', bad.length === 0, bad.map(e => e.id).join(', '));
  ok('ids are unique', new Set(ED.BUNDLED_EVENTS.map(e => e.id)).size === ED.BUNDLED_EVENTS.length);
  ok('the US releases are flagged tentative',
     ED.CALENDAR_EVENTS.filter(e => e.category === 'economic-data').every(e => e.tentative === true));
  ok('the central-bank dates are NOT', 
     ED.CALENDAR_EVENTS.filter(e => e.category === 'central-bank').every(e => !e.tentative));

  const built = EC.upcomingEvents(ED.BUNDLED_EVENTS, now, 6);
  ok('the bundled set fills the window', built.length > 10, `${built.length} events in six months`);
  ok('…every one of them in the future', built.every(e => Date.parse(e.date) >= now.getTime()));
}

console.log('\nYear-on-year — the inflation rate derived from the CPI index');
{
  const month = n => new Date(Date.UTC(2020, n, 1)).toISOString().slice(0, 10);
  // An index rising exactly 3% a year, monthly. Every reading must be 3.00%, and the
  // first twelve months produce nothing because they have no prior year.
  const compounding = Array.from({ length: 60 }, (_, i) =>
    ({ date: month(i), value: 100 * Math.pow(1.03, i / 12) }));
  const yoy = D.yearOverYear(compounding);
  ok('the first twelve months yield nothing', yoy.length === 60 - 12);
  ok('a 3%/year index reads 3.00% throughout',
     yoy.every(p => near(p.value, 3, 1e-9)), `${yoy[0].value.toFixed(6)}%`);
  ok('it starts at month 12, not 11 or 13', yoy[0].date === month(12));
  // A doubling in a year is +100%, and a halving −50%.
  const jump = [...Array.from({ length: 12 }, (_, i) => ({ date: month(i), value: 100 })),
                { date: month(12), value: 200 }, { date: month(13), value: 50 }];
  ok('a double over the year is +100%', near(D.yearOverYear(jump)[0].value, 100, 1e-9));
  ok('a halving is −50%', near(D.yearOverYear(jump)[1].value, -50, 1e-9));

  // THE WINDOW IS APPLIED AFTER. Filtering first would leave the first year of any view
  // with nothing to compare against, and a two-year request would come back with one.
  const windowed = D.yearOverYear(compounding, month(24));
  ok('a window keeps every month inside it', windowed.length === 60 - 24, `${windowed.length} points`);
  ok('…and none before it', windowed[0].date === month(24));

  // A GAP MUST NOT BE COMPARED AS IF IT WERE A YEAR. Drop three months from the middle:
  // the readings that would straddle the hole are dropped, the rest survive.
  const gapped = compounding.filter((_, i) => i < 20 || i > 22);
  const g = D.yearOverYear(gapped);
  ok('readings that straddle a gap are dropped', g.length < 60 - 12 - 3 + 1);
  ok('…and every surviving reading is still exactly 3%',
     g.every(p => near(p.value, 3, 1e-9)));
  // Without the guard the pair either side of the hole would be 15 months apart and
  // report ~3.8% as if it were a year.
  ok('…so no reading is inflated by the gap', g.every(p => p.value < 3.0001));

  ok('nothing from a series shorter than a year', D.yearOverYear(compounding.slice(0, 12)).length === 0);
  ok('nothing from nothing', D.yearOverYear([]).length === 0);
  // A zero or negative base would divide by zero and produce Infinity on the chart.
  ok('a zero prior value is skipped, not divided by',
     D.yearOverYear([...Array.from({ length: 12 }, (_, i) => ({ date: month(i), value: 0 })),
                     { date: month(12), value: 100 }]).length === 0);
}

console.log('\nMacro value formatting — shared by the dashboard and the Macro tab');
ok('a percent keeps two decimals', D.formatMacroValue(4.5, '%') === '4.50%');
ok('billions above a thousand become trillions', D.formatMacroValue(1500, 'B$') === '$1.5T');
ok('…and stay billions below it', D.formatMacroValue(900, 'B$') === '$900B');
ok('thousands roll up to millions', D.formatMacroValue(1500, 'K') === '1.5M');
ok('…and to billions', D.formatMacroValue(1_500_000, 'K') === '1.5B');

console.log('\nPhase bands — the arithmetic that has been wrong most often');
{
  const day = n => new Date(Date.UTC(2024, 0, 1 + n)).toISOString().slice(0, 10);
  const pts = (spec) => spec.map(([phase, close, revised], i) =>
    ({ date: day(i), close, phase, ...(revised ? { revised: true } : {}) }));

  // THE FLIP DAY BELONGS TO NEITHER BAND. Trending runs bars 0-2 rising 100→120, then
  // Lagging from bar 3. Trending must be +20%, measured to its OWN last day — not to
  // bar 3, whose fall is what broke it.
  const flip = R.buildPhaseRuns(pts([
    ['Trending', 100], ['Trending', 110], ['Trending', 120],
    ['Lagging', 90], ['Lagging', 80],
  ]));
  ok('two bands', flip.length === 2);
  ok('a band is measured to its own last day, not the flip', near(flip[0].ret, 20, 1e-9),
     `${flip[0].ret.toFixed(4)}%`);
  ok('…and the flip day is not credited backwards', !near(flip[0].ret, -10, 1e-9));
  ok('the next band starts ON the flip day', flip[1].from === day(3) && near(flip[1].ret, -11.111111, 1e-5));
  ok('bands touch for drawing', flip[0].to === flip[1].from);

  // MEASURED FROM THE LIVE CALL. A Recovering band drawn back to its low: bars 0-2 are
  // hindsight, the call arrives at bar 3. The band moves +100% in total but only +25%
  // after the call, and +25% is the figure that may be quoted.
  const rev = R.buildPhaseRuns(pts([
    ['Recovering', 50, true], ['Recovering', 70, true], ['Recovering', 80, true],
    ['Recovering', 80], ['Recovering', 100],
    ['Trending', 105],
  ]));
  ok('the whole drawn band is reported separately', near(rev[0].retFull, 100, 1e-9), `${rev[0].retFull}%`);
  ok('the quoted figure starts at the live call', near(rev[0].ret, 25, 1e-9), `${rev[0].ret}%`);
  ok('…and the call date is carried', rev[0].confirmed === day(3));
  ok('a band with no hindsight has no confirmed date', rev[1].confirmed === null);

  // THE DRAWDOWN ALSO STARTS AT THE LIVE CALL: the −60% before it is not the holder's.
  const dd = R.buildPhaseRuns(pts([
    ['Recovering', 100, true], ['Recovering', 40, true],
    ['Recovering', 100], ['Recovering', 90], ['Recovering', 95],
    ['Trending', 96],
  ]));
  ok('the drawdown is measured from the call, not the low', near(dd[0].dd, -10, 1e-9), `${dd[0].dd}%`);

  // THE RUNNING STRETCH is flagged and left out of the averages — the one thing that can
  // put a positive number on a phase that describes a fall.
  const open = R.buildPhaseRuns(pts([
    ['Lagging', 100], ['Lagging', 50], ['Trending', 60],
    ['Lagging', 50], ['Lagging', 90],
  ]));
  ok('only the last stretch is open', open.filter(r => r.open).length === 1 && open[open.length - 1].open);
  const stats = R.phaseAverages(open);
  ok('the open stretch is excluded from its average', near(stats.get('Lagging').avg, -50, 1e-9),
     `${stats.get('Lagging').avg}% (the open one is +80%)`);
  ok('…and from the run count', stats.get('Lagging').runs === 1);
  // In that fixture Trending's one stretch is CLOSED — it is not the last — so it does
  // have an average. The null case needs the open stretch to be the phase's only one,
  // which is the KOSPI shape: Lagging all the way and then a fresh Trending.
  ok('a closed stretch still averages', stats.get('Trending').avg != null);
  const onlyOpen = R.phaseAverages(R.buildPhaseRuns(pts([
    ['Lagging', 100], ['Lagging', 80], ['Lagging', 60], ['Trending', 70],
  ])));
  ok('a phase whose only stretch is open averages to null', onlyOpen.get('Trending').avg === null);
  ok('…and still reports zero finished runs', onlyOpen.get('Trending').runs === 0);

  // DRAWING vs MEASURING. A one-day final band is widened for drawing only; widening
  // `from` itself would hand it a day belonging to the phase before.
  const oneDay = R.buildPhaseRuns(pts([
    ['Trending', 100], ['Trending', 200], ['Lagging', 100],
  ]));
  const lastRun = oneDay[oneDay.length - 1];
  ok('a one-day band gets a wider left edge to draw', lastRun.drawFrom === day(1) && lastRun.from === day(2));
  ok('…but its return still starts on its own first day', near(lastRun.ret, 0, 1e-9),
     `${lastRun.ret}% — it would be −50% if the draw edge were used`);

  // Missing closes must not become zero.
  const gappy = R.buildPhaseRuns([
    { date: day(0), close: 100, phase: 'Trending' },
    { date: day(1), close: null, phase: 'Trending' },
    { date: day(2), close: 110, phase: 'Trending' },
  ]);
  ok('a missing close is skipped, not read as zero', near(gappy[0].ret, 10, 1e-9), `${gappy[0].ret}%`);
  ok('no bands from nothing', R.buildPhaseRuns([]).length === 0);
}

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

// ── Period windows: where a YTD/MTD series must begin ────────────────────────
// The bug these guard against was live: the quote card measured YTD from the last close
// of the previous year and the chart measured it from the first close of January, so one
// panel showed two different YTD figures for the same asset on the same day.
const W = await import(join(out, 'windows.js'));

ok('YTD starts at January 1st of the current year',
   W.calendarBoundary('YTD', new Date('2026-08-19T09:00:00Z')) === '2026-01-01');
ok('MTD starts at the 1st of the current month',
   W.calendarBoundary('MTD', new Date('2026-08-19T09:00:00Z')) === '2026-08-01');
ok('a single-digit month is zero-padded, or the string compares wrong',
   W.calendarBoundary('MTD', new Date('2026-03-04T09:00:00Z')) === '2026-03-01');
// Rolling windows are explicitly out of scope; returning a boundary for them would make
// the routes trim a window whose quote-side anchor is time-of-day dependent.
ok('rolling windows are not calendar periods',
   W.calendarBoundary('1M', new Date()) === null && W.calendarBoundary('MAX', new Date()) === null);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const days = (...ds) => ds.map(d => ({ date: d, close: 1 }));

// The equity case: the last session of the old year is December 31st.
ok('an equity series begins on the previous year\'s last close',
   eq(W.anchorSeries(days('2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05'), '2026-01-01'),
      days('2025-12-31', '2026-01-02', '2026-01-05')));
// The crypto case: January 1st IS a trading day, and using it as the baseline would throw
// away that day's move — which is the whole defect.
ok('a January 1st bar is inside the period, not the baseline for it',
   eq(W.anchorSeries(days('2025-12-31', '2026-01-01', '2026-01-02'), '2026-01-01'),
      days('2025-12-31', '2026-01-01', '2026-01-02')));
// New Year over a weekend: the last session can be several days back.
ok('a long closure still finds the anchor',
   eq(W.anchorSeries(days('2025-12-28', '2025-12-29', '2026-01-02'), '2026-01-01'),
      days('2025-12-29', '2026-01-02')));
ok('the lead-in is trimmed off, not left on the front',
   W.anchorSeries(days('2025-12-20', '2025-12-24', '2025-12-31', '2026-01-02'), '2026-01-01').length === 2);
// An asset that listed inside the window has no earlier close; its own first point is the
// only baseline there is, and dropping the series would be worse than an imprecise one.
ok('an asset that began inside the window keeps every point',
   eq(W.anchorSeries(days('2026-02-10', '2026-02-11'), '2026-01-01'),
      days('2026-02-10', '2026-02-11')));
ok('an empty series survives', eq(W.anchorSeries([], '2026-01-01'), []));
ok('a series entirely before the boundary keeps only its last point',
   eq(W.anchorSeries(days('2025-11-01', '2025-12-31'), '2026-01-01'), days('2025-12-31')));
// The arithmetic the fix exists to make agree: both figures now divide by the same close.
{
  const series = [
    { date: '2025-12-31', close: 87514 },
    { date: '2026-01-01', close: 88731 },
    { date: '2026-08-18', close: 64410.12 },
  ];
  const anchored = W.anchorSeries(series, '2026-01-01');
  const chartYtd = (anchored[anchored.length - 1].close / anchored[0].close - 1) * 100;
  const quoteYtd = (64410.12 / 87514 - 1) * 100;
  ok('chart return and quote return now agree', Math.abs(chartYtd - quoteYtd) < 1e-9);
  // Same numbers under the OLD rule, to show the check would have caught it.
  const oldYtd = (64410.12 / 88731 - 1) * 100;
  ok('and they disagreed by over a point before', Math.abs(oldYtd - quoteYtd) > 1);
}

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
