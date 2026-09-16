# DeepSeek peak hours

One screen answering one question: **is DeepSeek off-peak pricing active right now, and when does it change?**

- `Peak` / `Off-peak` for the current instant
- countdown to the next flip, floor-rounded to the wall clock, seconds below 5 minutes
- a 48-hour graphic of peak windows in local time, with a marker on *now*
- the documented rule in UTC next to its local translation, so a schedule change is visible

No build step, no dependencies, no network calls. Local time comes from the browser's zone
(`Intl`), so DST and cross-midnight windows are handled by the arithmetic rather than by cases.

## The rule

> Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC,
> Monday through Friday (all other hours are off-peak).
>
> — [DeepSeek API docs, Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing), footnote 3

`schedule.js` holds that rule as data and nothing else encodes it:

```js
export const PEAK_WINDOWS_UTC = [
  { start: 60, end: 240 },  // 01:00 - 04:00 UTC
  { start: 360, end: 600 }, // 06:00 - 10:00 UTC
];
export const PEAK_DAYS_UTC = [1, 2, 3, 4, 5]; // Mon - Fri
```

To follow a change: edit those two constants, update the quote above them, run `npm test`,
rebuild the image. Windows are minutes from UTC midnight and days are ISO weekdays — both
evaluated in UTC, because that is what the rule says.

## Run it

```sh
npm test                 # node --test, no dependencies
docker build -t deepseek-peak-hours .
docker run --rm -p 8080:8080 deepseek-peak-hours
```

Then open <http://localhost:8080>.

For editing, serve the directory over HTTP — a module script will not load from `file://`:

```sh
python3 -m http.server 8080
```

## Time zone

The zone is detected from the browser. Override it for a one-off check with `?tz=`:

```
http://localhost:8080/?tz=America/New_York
```

An unknown zone is ignored and detection is used instead. The resolved zone and its current
UTC offset are always shown, so a wrong zone is visible rather than silent.

## The image

`busybox` serving four static files — **6.2 MB**, no build stage.

- PID 1 is `docker-entrypoint.sh`, which forwards SIGTERM/SIGINT to httpd. Linux gives PID 1 no
  default signal actions, and busybox httpd installs no handler, so without the forwarder
  `docker stop` would wait out its whole grace period and Ctrl+C on `docker run` would do nothing.
  A single Ctrl+C now stops it, and a failing httpd still propagates its own exit status.
- runs as `nobody`; `HEALTHCHECK` uses the same binary's `wget`
- 48-hour graphic and countdown are pure client-side; the server never sees a clock
- caching: `ETag` revalidation works (`304`); busybox ignores `If-Modified-Since`, and there is
  no gzip — irrelevant for ~22 KB of assets

## Tests

`test/schedule.test.mjs` covers the two things that can actually be wrong: interval math and
rounding. It imports the shipped `schedule.js`, not a copy.

- state flips on the exact UTC window edges, weekends off-peak end to end
- the off-peak run that follows a peak is measured in full (the 2 h gap, the 15 h evening,
  the 63 h weekend)
- the countdown table, including the 5 m handoff (`5m` → `4m 59s`) and no leading zeroes
- DST: the same window sits at two local times either side of a transition, and a
  spring-forward day measures 23 h on the strip
- an invariant sweep asserting the strip marks exactly the period `stateAt` reports
