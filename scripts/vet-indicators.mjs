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
  'tsc', 'lib/indicators.ts', 'lib/rotationPhase.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck',
], { stdio: 'inherit' });
const I = await import(join(out, 'indicators.js'));
const Q = await import(join(out, 'rotationPhase.js'));

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

console.log('\nQuadrant position — the point, not just the name');
// Argument order is (X = gap to the 100-day trend, Y = momentum).
ok('above trend and gaining is Trending',    Q.quadrantPosition(5, 0.5).phase === 'Trending');
ok('below trend but gaining is Recovering',  Q.quadrantPosition(-5, 0.5).phase === 'Recovering');
ok('above trend but losing is Fading',       Q.quadrantPosition(5, -0.5).phase === 'Fading');
ok('below trend and losing is Lagging',      Q.quadrantPosition(-5, -0.5).phase === 'Lagging');
ok('zero momentum continues the leg',
   Q.quadrantPosition(5, 0).phase === 'Trending' && Q.quadrantPosition(-5, 0).phase === 'Lagging');
// Radius is a real distance in one unit, so a 3-4-5 triangle comes out at 5.
ok('radius is hypot(x, y)', near(Q.quadrantPosition(4, 3).radius, 5, 1e-9),
   `${Q.quadrantPosition(4, 3).radius.toFixed(6)}`);
// Amplitude survives: the same phase, ten times the swing, ten times the radius.
const small = Q.quadrantPosition(0.4, 0.3), big = Q.quadrantPosition(4, 3);
ok('a bigger swing sits further out', near(big.radius, small.radius * 10, 1e-9),
   `${small.radius.toFixed(2)} vs ${big.radius.toFixed(2)}%`);
// The cycle runs clockwise, so its angles fall in that order.
const ang = (x, y) => Q.quadrantPosition(x, y).angle;
ok('Recovering ~135°', near(ang(-1,  1), 135, 1e-9), `${ang(-1, 1).toFixed(1)}°`);
ok('Trending ~45°',    near(ang( 1,  1), 45, 1e-9),  `${ang(1, 1).toFixed(1)}°`);
ok('Fading ~315°',     near(ang( 1, -1), 315, 1e-9), `${ang(1, -1).toFixed(1)}°`);
ok('Lagging ~225°',    near(ang(-1, -1), 225, 1e-9), `${ang(-1, -1).toFixed(1)}°`);
ok('null when either coordinate is unknown', Q.quadrantPosition(null, 5) === null && Q.quadrantPosition(1, null) === null);

console.log('\nQuadrant axes from a price history — answers fixed by arithmetic');
const mkSeries = (n, f) => Array.from({ length: n }, (_, i) => ({
  // Weekdays only, so the bars-per-month scaling sees an equity-like calendar.
  date: new Date(Date.UTC(2016, 0, 4) + Math.floor(i / 5) * 7 * 86400000 + (i % 5) * 86400000).toISOString().slice(0, 10),
  close: f(i),
}));
// A price compounding at a constant rate sits a FIXED distance above its own trend and
// its MACD histogram is zero: the two EMAs and the signal all grow at the same rate.
const steady = mkSeries(900, i => 100 * Math.pow(1.0008, i));
const axSteady = Q.trendAxes(steady);
ok('a constant riser sits above its trend', axSteady.trendGap > 0, `${axSteady.trendGap.toFixed(3)}%`);
ok('a constant riser has ~zero momentum', near(axSteady.momentum, 0, 0.02), `${axSteady.momentum.toFixed(4)}%`);
ok('a constant riser is Trending', Q.classifyPhase(axSteady.trendGap, axSteady.momentum) === 'Trending');
// A flat price is exactly ON its trend with no momentum.
const flat = mkSeries(900, () => 100);
const axFlat = Q.trendAxes(flat);
ok('a flat price sits on its trend', near(axFlat.trendGap, 0, 1e-9), `${axFlat.trendGap.toFixed(9)}`);
ok('a flat price has zero momentum', near(axFlat.momentum, 0, 1e-9));
// Rising for years, then flat for two months: still above the trend, momentum now negative
// — the exit.
const stalling = mkSeries(900, i => 100 * Math.pow(1.0015, Math.min(i, 860)));
const axStall = Q.trendAxes(stalling);
ok('a stalled riser is Fading', Q.classifyPhase(axStall.trendGap, axStall.momentum) === 'Fading',
   `gap ${axStall.trendGap.toFixed(2)}%, momentum ${axStall.momentum.toFixed(3)}%`);
// Falling for years, then flat: still below the trend, momentum now positive — the entry.
const bouncing = mkSeries(900, i => 100 * Math.pow(0.9985, Math.min(i, 860)));
const axBounce = Q.trendAxes(bouncing);
ok('a fall that stops is Recovering', Q.classifyPhase(axBounce.trendGap, axBounce.momentum) === 'Recovering',
   `gap ${axBounce.trendGap.toFixed(2)}%, momentum ${axBounce.momentum.toFixed(3)}%`);
// A steady fall, still falling, is Lagging.
const falling = mkSeries(900, i => 100 * Math.pow(0.999, i));
ok('a steady fall is Lagging', Q.classifyPhase(...Object.values(Q.trendAxes(falling))) !== 'Trending');
ok('a steady fall sits below its trend', Q.trendAxes(falling).trendGap < 0, `${Q.trendAxes(falling).trendGap.toFixed(3)}%`);
// Amplitude: a volatile series swings further from its own trend than a calm one, which
// is what makes distance from the centre mean the size of the move.
const calm = mkSeries(900, i => 100 * (1 + 0.02 * Math.sin(i / 40)));
const wild = mkSeries(900, i => 100 * (1 + 0.20 * Math.sin(i / 40)));
ok('a wilder asset orbits wider',
   Math.abs(Q.trendAxes(wild).trendGap) > Math.abs(Q.trendAxes(calm).trendGap) * 5,
   `${Q.trendAxes(calm).trendGap.toFixed(2)}% vs ${Q.trendAxes(wild).trendGap.toFixed(2)}%`);

// Too little history is null, not a number computed from whatever is there: an EMA-100
// seeded twenty bars ago is just those twenty bars wearing a longer name.
// The warm-up is 2.5 trend spans plus the smoothing window; one bar short must be null,
// not a number, and one bar past it must be a number — the boundary tested from both sides.
// The warm-up is 2.5 trend spans plus the smoothing window, counted in BARS and scaled by
// the calendar the history actually has (weekday bars → ~21.7 a month). Tested from both
// sides with a margin, so the check does not encode that scaling twice.
const need = Q.TREND_SPAN * 2.5 + Q.TREND_SMOOTH;
ok('null below the warm-up', Q.trendAxes(mkSeries(Math.round(need * 0.9), i => 100 + i)) === null);
ok('a number above it', Q.trendAxes(mkSeries(Math.round(need * 1.15), i => 100 + i)) != null);
ok('null on an empty history', Q.trendAxes([]) === null && Q.trendAxes(undefined) === null);
// As-of dates never read forward: asking for a date in the middle gives the same answer
// as truncating the file there.
const cut = steady[700].date;
const asOf = Q.trendAxes(steady, cut), truncated = Q.trendAxes(steady.slice(0, 701));
ok('as-of reads no forward data',
   near(asOf.trendGap, truncated.trendGap, 1e-12) && near(asOf.momentum, truncated.momentum, 1e-12));

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
