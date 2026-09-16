import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStrip,
  comingOffPeak,
  describe,
  formatDuration,
  formatOffset,
  formatPeakRuleUtc,
  makeZone,
  nextTransition,
  resolveZone,
  stateAt,
  stripLeft,
} from '../schedule.js';

const U = (...parts) => Date.UTC(...parts);
const minsk = makeZone('Europe/Minsk');
const newYork = makeZone('America/New_York');

test('countdown text follows floor semantics and drops to seconds below 5m', () => {
  const cases = [
    [15 * 3_600_000 + 12 * 60_000 + 4_000, '15h 12m'],
    [1 * 3_600_000 + 4 * 60_000 + 59_000, '1h 4m'],
    [1 * 3_600_000 + 30_000, '1h'],
    [40 * 60_000 + 59_000, '40m'],
    [5 * 60_000 + 36_000, '5m'],
    [5 * 60_000, '5m'],
    [4 * 60_000 + 59_000, '4m 59s'],
    [60_000 + 9_000, '1m 9s'],
    [59_000, '59s'],
    [4_000, '4s'],
    [63 * 3_600_000, '2d 15h'],
  ];
  for (const [ms, expected] of cases) {
    assert.equal(formatDuration(ms), expected, `${ms}ms`);
  }
});

test('state flips exactly on the UTC window edges', () => {
  assert.equal(stateAt(U(2026, 8, 16, 0, 59, 59)), 'off-peak');
  assert.equal(stateAt(U(2026, 8, 16, 1, 0, 0)), 'peak');
  assert.equal(stateAt(U(2026, 8, 16, 3, 59, 59)), 'peak');
  assert.equal(stateAt(U(2026, 8, 16, 4, 0, 0)), 'off-peak');
  assert.equal(stateAt(U(2026, 8, 16, 5, 59, 59)), 'off-peak');
  assert.equal(stateAt(U(2026, 8, 16, 6, 0, 0)), 'peak');
  assert.equal(stateAt(U(2026, 8, 16, 9, 59, 59)), 'peak');
  assert.equal(stateAt(U(2026, 8, 16, 10, 0, 0)), 'off-peak');
});

test('weekends are off-peak for their whole length', () => {
  assert.equal(stateAt(U(2026, 8, 19, 2, 0, 0)), 'off-peak'); // Saturday
  assert.equal(stateAt(U(2026, 8, 20, 7, 0, 0)), 'off-peak'); // Sunday
  assert.equal(nextTransition(U(2026, 8, 19, 2, 0, 0)).at, U(2026, 8, 21, 1, 0));
});

test('next transition is the flip that follows the given instant', () => {
  const duringPeak = nextTransition(U(2026, 8, 16, 9, 8)); // Wednesday
  assert.equal(duringPeak.at, U(2026, 8, 16, 10, 0));
  assert.equal(duringPeak.state, 'off-peak');

  const inGap = nextTransition(U(2026, 8, 16, 4, 30)); // the 04:00-06:00 gap
  assert.equal(inGap.at, U(2026, 8, 16, 6, 0));
  assert.equal(inGap.state, 'peak');

  const beforePeak = nextTransition(U(2026, 8, 16, 0, 30));
  assert.equal(beforePeak.at, U(2026, 8, 16, 1, 0));
});

test('the off-peak run that follows a peak is measured in full', () => {
  const midday = comingOffPeak(U(2026, 8, 16, 9, 8)); // Wed 10:00 UTC -> Thu 01:00 UTC
  assert.equal(midday.start, U(2026, 8, 16, 10, 0));
  assert.equal(midday.end, U(2026, 8, 17, 1, 0));
  assert.equal(midday.durationMs, 15 * 3_600_000);

  const weekend = comingOffPeak(U(2026, 8, 18, 9, 0)); // Fri 10:00 UTC -> Mon 01:00 UTC
  assert.equal(weekend.start, U(2026, 8, 18, 10, 0));
  assert.equal(weekend.end, U(2026, 8, 21, 1, 0));
  assert.equal(weekend.durationMs, 63 * 3_600_000);

  const bridge = comingOffPeak(U(2026, 8, 16, 1, 30)); // the 04:00-06:00 gap is 2h
  assert.equal(bridge.durationMs, 2 * 3_600_000);
});

test('local rendering uses a 24-hour clock at whole-hour and half-hour offsets', () => {
  assert.equal(minsk.time(U(2026, 8, 16, 9, 8)), '12:08');
  assert.equal(minsk.day(U(2026, 8, 16, 9, 8)), 'Wed 16 Sept');
  assert.equal(minsk.offsetLabel(U(2026, 8, 16, 9, 8)), 'UTC+03:00');
  assert.equal(minsk.time(minsk.localDayStart(U(2026, 8, 16, 9, 8))), '00:00');

  const kolkata = makeZone('Asia/Kolkata');
  assert.equal(kolkata.band(U(2026, 8, 16, 1, 0), U(2026, 8, 16, 4, 0)), '06:30\u201309:30');
});

test('offsets are read per instant, so DST shifts the same window', () => {
  assert.equal(newYork.time(U(2026, 2, 9, 1, 0)), '21:00'); // Mon 01:00 UTC = Sun 21:00 EDT
  assert.equal(newYork.time(U(2026, 2, 9, 4, 0)), '00:00');
  assert.equal(newYork.band(U(2026, 2, 9, 1, 0), U(2026, 2, 9, 4, 0)), '21\u201300');
  assert.equal(newYork.offsetLabel(U(2026, 2, 7, 17, 0)), 'UTC-05:00'); // EST
  assert.equal(newYork.offsetLabel(U(2026, 2, 9, 17, 0)), 'UTC-04:00'); // EDT
});

test('formatOffset renders sign, zero padding and half hours', () => {
  assert.equal(formatOffset(0), 'UTC+00:00');
  assert.equal(formatOffset(180), 'UTC+03:00');
  assert.equal(formatOffset(-300), 'UTC-05:00');
  assert.equal(formatOffset(-330), 'UTC-05:30');
});

test('the strip spans 48 local hours and measures DST days honestly', () => {
  const strip = buildStrip(U(2026, 8, 16, 9, 8), minsk);
  assert.equal(strip.end - strip.start, 48 * 3_600_000);
  assert.equal(strip.days.map((d) => d.label).join(' | '), 'Wed 16 Sept | Thu 17 Sept');
  assert.equal(strip.days[0].width, 50);
  assert.deepEqual(
    strip.bands.map((band) => band.label),
    ['04\u201307', '09\u201313', '04\u201307', '09\u201313'],
  );
  assert.deepEqual(
    strip.bands.map((band) => band.active),
    [false, true, false, false],
  );
  assert.equal(strip.ticks.length, 8);

  const springForward = buildStrip(U(2026, 2, 8, 17, 0), newYork); // 12:00 local, DST day
  assert.equal(springForward.days[0].end - springForward.days[0].start, 23 * 3_600_000);
  assert.equal(springForward.end - springForward.start, 47 * 3_600_000);
});

test('the strip marks exactly the period the state reports', () => {
  for (const [strip, zone] of [
    [buildStrip(U(2026, 8, 16, 9, 8), minsk), minsk],
    [buildStrip(U(2026, 2, 8, 17, 0), newYork), newYork],
  ]) {
    for (let at = strip.start; at < strip.end; at += 5 * 60_000) {
      const inBand = strip.bands.some((band) => band.start <= at && at < band.end);
      assert.equal(inBand, stateAt(at) === 'peak', new Date(at).toISOString());
    }
    // The marker sits inside the strip for any instant it claims to cover.
    assert.equal(stripLeft(strip, strip.start), 0);
    assert.equal(stripLeft(strip, strip.start + (strip.end - strip.start) / 2), 50);
    assert.equal(stripLeft(strip, strip.end), 100);
    assert.equal(stripLeft(strip, strip.end + 60_000), 100);
    assert.equal(zone.time(strip.start), '00:00');
  }
});

test('describe composes the lines the page shows', () => {
  const peak = describe(U(2026, 8, 16, 9, 8), minsk);
  assert.equal(peak.state, 'peak');
  assert.equal(peak.headline, 'Peak ends in 52m');
  assert.equal(peak.detail, 'Off-peak at 13:00 \u00b7 lasts 15h');
  assert.equal(peak.offset, 'UTC+03:00');

  const offPeak = describe(U(2026, 8, 16, 5, 0), minsk);
  assert.equal(offPeak.state, 'off-peak');
  assert.equal(offPeak.headline, 'Peak starts in 1h');
  assert.equal(offPeak.detail, 'Next peak 09:00');

  // Weekday appears only when the flip lands on a different local day.
  const losAngeles = makeZone('America/Los_Angeles');
  const crossing = describe(U(2026, 8, 21, 6, 30), losAngeles);
  assert.equal(crossing.state, 'peak');
  assert.equal(crossing.detail, 'Off-peak at Mon 03:00 \u00b7 lasts 15h');
});

test('the rule block is derived from the constants', () => {
  assert.equal(formatPeakRuleUtc(), '01:00\u201304:00 and 06:00\u201310:00 UTC, Mon\u2013Fri');
  assert.equal(
    describe(U(2026, 8, 16, 9, 8), minsk).ruleLocal,
    '04:00\u201307:00 and 09:00\u201313:00 (Europe/Minsk)',
  );
});

test('the zone comes from the browser, with ?tz= as an override', () => {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(resolveZone(''), detected);
  assert.equal(resolveZone('?tz=Asia%2FKolkata'), 'Asia/Kolkata');
  assert.equal(resolveZone('?tz=Not/AZone'), detected);
});
