import { buildStrip, describe, formatDuration, makeZone, resolveZone, stripLeft } from './schedule.js';

const zone = makeZone(resolveZone(window.location.search));

const ui = {
  card: document.querySelector('.card'),
  state: document.getElementById('state-word'),
  countdown: document.getElementById('countdown'),
  detail: document.getElementById('detail'),
  strip: document.getElementById('strip'),
  days: document.getElementById('days'),
  bands: document.getElementById('bands'),
  ruler: document.getElementById('ruler'),
  now: document.getElementById('now'),
  nowLabel: document.getElementById('now-label'),
  zone: document.getElementById('zone'),
  ruleUtc: document.getElementById('rule-utc'),
  ruleLocal: document.getElementById('rule-local'),
};

let strip = null;
let stripDay = null;
let bandNodes = [];

/** Rebuild the 48h graphic — only when the local day rolls over. */
function paintStrip(next, now) {
  strip = next;
  stripDay = zone.localDayStart(now);
  bandNodes = [];

  ui.days.replaceChildren(
    ...strip.days.map((day) => {
      const node = document.createElement('div');
      node.className = 'day';
      node.style.left = `${day.left}%`;
      node.style.width = `${day.width}%`;
      node.textContent = day.label;
      return node;
    }),
  );

  const marks = strip.ticks.map((tick) => {
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.left = `${tick.left}%`;
    return grid;
  });

  for (const band of strip.bands) {
    const node = document.createElement('div');
    node.className = 'band';
    node.style.left = `${band.left}%`;
    node.style.width = `${band.width}%`;
    node.dataset.start = band.start;
    node.dataset.end = band.end;
    const label = document.createElement('span');
    label.className = 'band-label';
    label.textContent = band.label;
    node.append(label);
    bandNodes.push(node);
  }

  ui.bands.replaceChildren(...marks, ...bandNodes);

  ui.ruler.replaceChildren(
    ...strip.ticks.map((tick) => {
      const node = document.createElement('div');
      node.className = 'tick';
      node.style.left = `${tick.left}%`;
      node.textContent = tick.label;
      return node;
    }),
  );
}

function render(now) {
  const model = describe(now, zone);
  const isPeak = model.state === 'peak';

  ui.card.dataset.state = model.state;
  ui.state.textContent = isPeak ? 'Peak' : 'Off-peak';
  ui.countdown.textContent = model.headline;
  ui.detail.textContent = model.detail;
  ui.zone.textContent = `${model.zone} \u00b7 ${model.offset}`;
  ui.ruleUtc.textContent = model.ruleUtc;
  ui.ruleLocal.textContent = model.ruleLocal;
  document.title = `${isPeak ? 'Peak' : 'Off-peak'} \u00b7 ${formatDuration(model.remainingMs)}`;

  // The graphic only changes shape at local midnight; the marker moves every tick.
  if (stripDay !== zone.localDayStart(now)) paintStrip(buildStrip(now, zone), now);
  ui.now.style.left = `${stripLeft(strip, now)}%`;
  ui.nowLabel.style.left = ui.now.style.left;
  ui.nowLabel.textContent = zone.time(now);
  for (const node of bandNodes) {
    node.classList.toggle('is-active', +node.dataset.start <= now && now < +node.dataset.end);
  }

  const windows = [...new Set(strip.bands.map((band) => band.label))].join(' and ');
  const state = isPeak ? 'Peak' : 'Off-peak';
  ui.strip.setAttribute(
    'aria-label',
    windows
      ? `${state} now, ${model.headline.toLowerCase()}. Peak hours ${windows} local time over the next 48 hours.`
      : `${state} now, ${model.headline.toLowerCase()}. No peak hours in the next 48 hours.`,
  );
}

// Ticks land on real second boundaries, and every render re-derives from the
// system clock, so a slept tab or a clock jump never desyncs the countdown.
let timer = null;
function tick() {
  clearTimeout(timer);
  render(Date.now());
  timer = setTimeout(tick, 1000 - (Date.now() % 1000));
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

tick();
