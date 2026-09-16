/**
 * DeepSeek peak / off-peak schedule — the app's single source of truth.
 *
 * DeepSeek API docs, "Models & Pricing", footnote 3:
 *   "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00
 *    and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak)."
 *   https://api-docs.deepseek.com/quick_start/pricing
 *
 * To follow a schedule change, edit PEAK_WINDOWS_UTC / PEAK_DAYS_UTC and the
 * quote above. Nothing else in the app encodes the rule.
 *
 * Windows are minutes from UTC midnight; days are ISO weekdays (Mon = 1) in UTC.
 * Both are evaluated in UTC because that is what the rule says — local time is
 * only ever a rendering of an absolute instant, so DST and cross-midnight
 * windows fall out of the arithmetic instead of being special-cased.
 *
 * This file is a plain ES module: no DOM, and every function takes the instant it
 * should reason about (`ms`), so Node imports and tests the exact shipped bytes.
 */

export const PEAK_WINDOWS_UTC = [
  { start: 60, end: 240 }, // 01:00 - 04:00 UTC
  { start: 360, end: 600 }, // 06:00 - 10:00 UTC
];

export const PEAK_DAYS_UTC = [1, 2, 3, 4, 5]; // Mon - Fri

/** Below this much remaining, the countdown shows seconds. */
export const SECONDS_THRESHOLD_MS = 300_000; // 5m

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const UTC_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ------------------------------------------------------------------ state */

/** @returns {'peak' | 'off-peak'} */
export function stateAt(ms) {
  const date = new Date(ms);
  if (!PEAK_DAYS_UTC.includes(date.getUTCDay())) return 'off-peak';
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const withinWindow = PEAK_WINDOWS_UTC.some((w) => minute >= w.start && minute < w.end);
  return withinWindow ? 'peak' : 'off-peak';
}

/** Instant of the next peak/off-peak flip strictly after `ms`. */
export function nextTransition(ms) {
  const firstDay = utcDayStart(ms) - DAY_MS;
  for (let i = 0; i < 9; i += 1) {
    const dayStart = firstDay + i * DAY_MS;
    if (!PEAK_DAYS_UTC.includes(new Date(dayStart).getUTCDay())) continue;
    for (const w of PEAK_WINDOWS_UTC) {
      const start = dayStart + w.start * MINUTE_MS;
      const end = dayStart + w.end * MINUTE_MS;
      if (start > ms) return { at: start, state: 'peak' };
      if (end > ms) return { at: end, state: 'off-peak' };
    }
  }
  throw new RangeError('no peak/off-peak transition found');
}

/** The off-peak run that begins at the next flip — its start, end and length. */
export function comingOffPeak(ms) {
  const start = nextTransition(ms).at;
  const end = nextTransition(start).at;
  return { start, end, durationMs: end - start };
}

/** Next occurrence of a single window at or after `ms`, in absolute time. */
export function nextOccurrence(ms, window) {
  const firstDay = utcDayStart(ms);
  for (let i = 0; i < 9; i += 1) {
    const dayStart = firstDay + i * DAY_MS;
    if (!PEAK_DAYS_UTC.includes(new Date(dayStart).getUTCDay())) continue;
    const start = dayStart + window.start * MINUTE_MS;
    if (start > ms) return { start, end: dayStart + window.end * MINUTE_MS };
  }
  throw new RangeError('no occurrence of the window found');
}

function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* -------------------------------------------------------------- duration */

/**
 * Countdown text. Floor semantics, against the wall clock: a displayed minute
 * always means at least that much time remains, and each step lands on a clock
 * minute. Seconds appear only below 5m. No leading zeroes, at most two units.
 */
export function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const total = Math.floor(ms / 1000);

  if (ms < SECONDS_THRESHOLD_MS) {
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const units = [];
  if (days) units.push(`${days}d`);
  if (hours) units.push(`${hours}h`);
  if (minutes) units.push(`${minutes}m`);
  if (units.length === 0) units.push('0m');
  return units.slice(0, 2).join(' ');
}

/* ------------------------------------------------------------------ zones */

/** IANA zone from the browser, overridable with `?tz=` (invalid values ignored). */
export function resolveZone(search = '') {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const requested = new URLSearchParams(search).get('tz');
  if (!requested) return detected;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: requested });
    return requested;
  } catch {
    return detected;
  }
}

/** Local-time rendering for one zone, with formatters built once. */
export function makeZone(timeZone) {
  const formatter = (options) => new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
  const timeFmt = formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const clockFmt = formatter({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const dayFmt = formatter({ weekday: 'short', day: 'numeric', month: 'short' });
  const keyFmt = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const stampFmt = formatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const partsOf = (fmt, ms) => {
    const out = {};
    for (const { type, value } of fmt.formatToParts(ms)) out[type] = value;
    return out;
  };

  /** Offset in minutes at that instant — DST-correct because it is read per instant. */
  const offsetMinutes = (ms) => {
    const p = partsOf(stampFmt, ms);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - ms) / MINUTE_MS);
  };

  /** Wall-clock time in this zone -> absolute instant (two-pass, DST-safe). */
  const wallToInstant = (year, month, day, hour, minute) => {
    const naive = Date.UTC(year, month - 1, day, hour, minute);
    const guess = naive - offsetMinutes(naive) * MINUTE_MS;
    return naive - offsetMinutes(guess) * MINUTE_MS;
  };

  const dateParts = (ms) => {
    const p = partsOf(keyFmt, ms);
    return { year: +p.year, month: +p.month, day: +p.day };
  };

  const localDayStart = (ms) => {
    const { year, month, day } = dateParts(ms);
    return wallToInstant(year, month, day, 0, 0);
  };

  const nextLocalDayStart = (ms) => {
    const { year, month, day } = dateParts(ms);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return wallToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0);
  };

  const shortTime = (text) => (text.endsWith(':00') ? text.slice(0, 2) : text);
  const time = (ms) => timeFmt.format(ms);
  const dayShort = (ms) => partsOf(dayFmt, ms).weekday;
  const day = (ms) => {
    const p = partsOf(dayFmt, ms);
    return `${p.weekday} ${p.day} ${p.month}`;
  };
  const dayKey = (ms) => {
    const p = partsOf(keyFmt, ms);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const offsetLabel = (ms) => formatOffset(offsetMinutes(ms));

  return {
    name: timeZone,
    time,
    clock: (ms) => clockFmt.format(ms),
    day,
    dayShort,
    dayKey,
    dateParts,
    offsetMinutes,
    offsetLabel,
    wallToInstant,
    localDayStart,
    nextLocalDayStart,
    range: (start, end) => `${time(start)}\u2013${time(end)}`,
    band: (start, end) => `${shortTime(time(start))}\u2013${shortTime(time(end))}`,
  };
}

export function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/* --------------------------------------------------------------- the rule */

const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The documented rule, rendered from the constants above. */
export function formatPeakRuleUtc() {
  const windows = PEAK_WINDOWS_UTC.map((w) => `${hhmm(w.start)}\u2013${hhmm(w.end)}`).join(' and ');
  const names = PEAK_DAYS_UTC.map((d) => UTC_DAY_NAMES[d]);
  const contiguous = PEAK_DAYS_UTC.every((d, i) => i === 0 || d === PEAK_DAYS_UTC[i - 1] + 1);
  const days = contiguous ? `${names[0]}\u2013${names[names.length - 1]}` : names.join(', ');
  return `${windows} UTC, ${days}`;
}

/** The same rule translated into the reader's zone, via each window's next run. */
export function formatPeakRuleLocal(ms, z) {
  const windows = PEAK_WINDOWS_UTC.map((w) => {
    const run = nextOccurrence(ms, w);
    return z.range(run.start, run.end);
  }).join(' and ');
  return `${windows} (${z.name})`;
}

/* ------------------------------------------------------------ strip model */

/**
 * 48 local hours from today's local midnight: day segments (positioned by real
 * elapsed time, so a DST-shortened day measures shorter), peak bands, 6-hour
 * ticks, and where "now" sits.
 */
export function buildStrip(now, z) {
  const start = z.localDayStart(now);
  const mid = z.nextLocalDayStart(start);
  const end = z.nextLocalDayStart(mid);
  const span = end - start;
  const left = (ms) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));

  const days = [
    { start, end: mid, label: z.day(start) },
    { start: mid, end, label: z.day(mid) },
  ].map((d) => ({ ...d, left: left(d.start), width: left(d.end) - left(d.start) }));

  const bands = [];
  const firstDay = utcDayStart(start) - DAY_MS;
  const lastDay = utcDayStart(end) + DAY_MS;
  for (let dayStart = firstDay; dayStart <= lastDay; dayStart += DAY_MS) {
    if (!PEAK_DAYS_UTC.includes(new Date(dayStart).getUTCDay())) continue;
    for (const w of PEAK_WINDOWS_UTC) {
      const bandStart = dayStart + w.start * MINUTE_MS;
      const bandEnd = dayStart + w.end * MINUTE_MS;
      if (bandEnd <= start || bandStart >= end) continue;
      bands.push({
        start: bandStart,
        end: bandEnd,
        active: bandStart <= now && now < bandEnd,
        label: z.band(bandStart, bandEnd),
        left: left(bandStart),
        width: left(bandEnd) - left(bandStart),
      });
    }
  }

  const ticks = [];
  for (const d of days) {
    const { year, month, day } = z.dateParts(d.start);
    for (let hour = 0; hour < 24; hour += 6) {
      const at = z.wallToInstant(year, month, day, hour, 0);
      if (at < start || at > end) continue;
      ticks.push({ at, left: left(at), label: String(hour).padStart(2, '0') });
    }
  }

  return { start, end, days, bands, ticks, nowLeft: left(now) };
}

/** Fraction of the strip where `ms` sits, clamped to its edges. */
export function stripLeft(strip, ms) {
  const pct = ((ms - strip.start) / (strip.end - strip.start)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/* ------------------------------------------------------------------ model */

/** Everything the view needs for one instant, except the 48h graphic. */
export function describe(now, z) {
  const state = stateAt(now);
  const next = nextTransition(now);
  const remainingMs = next.at - now;
  const countdown = formatDuration(remainingMs);

  // Weekday is only shown when the local calendar day differs from today's.
  const stamp = (at) =>
    z.dayKey(at) === z.dayKey(now) ? z.time(at) : `${z.dayShort(at)} ${z.time(at)}`;

  let headline;
  let detail;
  if (state === 'peak') {
    const gap = comingOffPeak(now);
    headline = `Peak ends in ${countdown}`;
    detail = `Off-peak at ${stamp(gap.start)} \u00b7 lasts ${formatDuration(gap.durationMs)}`;
  } else {
    headline = `Peak starts in ${countdown}`;
    detail = `Next peak ${stamp(next.at)}`;
  }

  return {
    state,
    headline,
    detail,
    remainingMs,
    zone: z.name,
    offset: z.offsetLabel(now),
    ruleUtc: formatPeakRuleUtc(),
    ruleLocal: formatPeakRuleLocal(now, z),
  };
}
