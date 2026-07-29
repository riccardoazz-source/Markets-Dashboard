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
  'tsc', 'lib/indicators.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck',
], { stdio: 'inherit' });
const I = await import(join(out, 'indicators.js'));

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

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
