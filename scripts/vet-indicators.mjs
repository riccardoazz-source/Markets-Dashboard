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
// Argument order is (X = 12-month pace, Y = change in that pace).
ok('up and strengthening is Trending',    Q.quadrantPosition(2, 0.5).phase === 'Trending');
ok('down but strengthening is Recovering', Q.quadrantPosition(-2, 0.5).phase === 'Recovering');
ok('up but weakening is Fading',          Q.quadrantPosition(2, -0.5).phase === 'Fading');
ok('down and weakening is Lagging',       Q.quadrantPosition(-2, -0.5).phase === 'Lagging');
// Radius is a real distance in one unit, so a 3-4-5 triangle comes out at 5.
ok('radius is hypot(x, y)', near(Q.quadrantPosition(4, 3).radius, 5, 1e-9),
   `${Q.quadrantPosition(4, 3).radius.toFixed(6)}`);
// Amplitude survives: the same phase, ten times the swing, ten times the radius.
const small = Q.quadrantPosition(0.4, 0.3), big = Q.quadrantPosition(4, 3);
ok('a bigger swing sits further out', near(big.radius, small.radius * 10, 1e-9),
   `${small.radius.toFixed(2)} vs ${big.radius.toFixed(2)} %/mo`);
// The cycle runs clockwise, so its angles fall in that order.
const ang = (x, y) => Q.quadrantPosition(x, y).angle;
ok('Recovering ~135°', near(ang(-1,  1), 135, 1e-9), `${ang(-1, 1).toFixed(1)}°`);
ok('Trending ~45°',    near(ang( 1,  1), 45, 1e-9),  `${ang(1, 1).toFixed(1)}°`);
ok('Fading ~315°',     near(ang( 1, -1), 315, 1e-9), `${ang(1, -1).toFixed(1)}°`);
ok('Lagging ~225°',    near(ang(-1, -1), 225, 1e-9), `${ang(-1, -1).toFixed(1)}°`);
ok('null when either coordinate is unknown', Q.quadrantPosition(null, 5) === null && Q.quadrantPosition(1, null) === null);

console.log('\nQuadrant axes from a price history — answers fixed by arithmetic');
// A daily series compounding at exactly 1%/month for four years. The 12-month pace
// is 1.00 %/month everywhere, so the smoothed pace is 1.00 and its change is 0.
const mkSeries = (n, f) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
  close: f(i),
}));
const steady = mkSeries(1500, i => 100 * Math.pow(1.01, i / 30.4375));
const axSteady = Q.trendAxes(steady);
ok('a constant 1%/month pace reads 1.00 %/mo', near(axSteady.trendPace, 1, 0.02), `${axSteady.trendPace.toFixed(4)}`);
ok('a constant pace has zero impulse', near(axSteady.trendImpulse, 0, 0.01), `${axSteady.trendImpulse.toFixed(5)}`);
ok('a constant riser is Trending', Q.classifyPhase(axSteady.trendPace, axSteady.trendImpulse) === 'Trending');

// Flat for three years, then +1%/month for the last three months: the 12-month pace
// is still small but rising, which is the definition of Recovering's neighbour —
// here it is positive, so Trending; what matters is the SIGN of the impulse.
const turning = mkSeries(1200, i => (i < 1110 ? 100 : 100 * Math.pow(1.01, (i - 1110) / 30.4375)));
const axTurn = Q.trendAxes(turning);
ok('a fresh upturn has a positive impulse', axTurn.trendImpulse > 0, `${axTurn.trendImpulse.toFixed(4)}`);
// The mirror image: rising for years, then flat for three months → pace still
// positive, impulse negative. That is Fading, the exit.
const stalling = mkSeries(1200, i => 100 * Math.pow(1.01, Math.min(i, 1110) / 30.4375));
const axStall = Q.trendAxes(stalling);
ok('a stalled riser is Fading', Q.classifyPhase(axStall.trendPace, axStall.trendImpulse) === 'Fading',
   `pace ${axStall.trendPace.toFixed(2)}, impulse ${axStall.trendImpulse.toFixed(3)}`);
// A falling series that is falling less hard is Recovering, not Lagging.
const bouncing = mkSeries(1200, i => (i < 1110 ? 100 * Math.pow(0.97, i / 30.4375) : 100 * Math.pow(0.97, 1110 / 30.4375)));
const axBounce = Q.trendAxes(bouncing);
ok('a fall that stops is Recovering', Q.classifyPhase(axBounce.trendPace, axBounce.trendImpulse) === 'Recovering',
   `pace ${axBounce.trendPace.toFixed(2)}, impulse ${axBounce.trendImpulse.toFixed(3)}`);

// Too little history is null, not a number computed from whatever is there: an
// asset listed six months ago has no position in a 12-month cycle.
ok('null below the required history', Q.trendAxes(mkSeries(300, i => 100 + i)) === null);
ok('null on an empty history', Q.trendAxes([]) === null && Q.trendAxes(undefined) === null);
// As-of dates never read forward: asking for a date in the middle gives the same
// answer as truncating the file there.
const cut = steady[900].date;
const asOf = Q.trendAxes(steady, cut);
const truncated = Q.trendAxes(steady.slice(0, 901));
ok('as-of reads no forward data',
   near(asOf.trendPace, truncated.trendPace, 1e-12) && near(asOf.trendImpulse, truncated.trendImpulse, 1e-12));

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
