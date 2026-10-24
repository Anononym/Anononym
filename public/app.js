import { renderCharacter, characterState } from './character.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let state = null;

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

async function refresh() {
  state = await api('/api/state');
  renderAll();
}

// ---------- Time math (browser's local time zone) ----------

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function allSessions() {
  const list = state.sessions.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  if (state.activeSession) list.push({ start: new Date(state.activeSession.start), end: new Date() });
  return list;
}

const workedBetween = (from, to = new Date()) =>
  allSessions().reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0);
const countSince = (list, from) => list.filter((e) => new Date(e.date) >= from).length;
const incomeSince = (from) => state.income.filter((e) => new Date(e.date) >= from).reduce((s, e) => s + e.amount, 0);
const sleepSince = (from) => state.sleep.filter((e) => new Date(`${e.day}T12:00`) >= from);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function computeStats() {
  const month = startOfMonth();
  const week = startOfWeek();
  const lastNight = state.sleep.find((e) => e.day === dayKey(new Date()));
  return {
    workDay: workedBetween(startOfDay()),
    workWeek: workedBetween(week),
    workMonth: workedBetween(month),
    incomeMonth: incomeSince(month),
    trainWeek: countSince(state.trainings, week),
    trainMonth: countSince(state.trainings, month),
    sleepNight: lastNight ? lastNight.minutes : null,
    sleepAvg: avg(sleepSince(addDays(startOfDay(), -6)).map((e) => e.minutes)),
  };
}

// ---------- Goals ----------

// unit: 'h' = hours (stored as decimal hours), 'eur', 'x' = count
const GOALS = {
  workDay: { kind: 'work', title: 'Arbeit pro Tag', unit: 'h' },
  workWeek: { kind: 'work', title: 'Arbeit pro Woche', unit: 'h' },
  workMonth: { kind: 'work', title: 'Arbeit pro Monat', unit: 'h' },
  incomeMonth: { kind: 'money', title: 'Umsatz pro Monat', unit: 'eur' },
  trainWeek: { kind: 'train', title: 'Trainings pro Woche', unit: 'x' },
  trainMonth: { kind: 'train', title: 'Trainings pro Monat', unit: 'x' },
  sleepNight: { kind: 'sleep', title: 'Schlaf pro Nacht', unit: 'h' },
};

// Accepts "9:30", "9.5", "9,5" or "9h 30m" → decimal hours.
function parseHours(text) {
  const t = String(text).trim().toLowerCase();
  const hm = t.match(/^(\d+)\s*(?::|h)\s*(\d{1,2})?\s*m?$/);
  if (hm) return Number(hm[1]) + Number(hm[2] || 0) / 60;
  const n = Number(t.replace(',', '.').replace(/h$/, ''));
  return Number.isFinite(n) ? n : NaN;
}
const hoursToInput = (h) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const fmtGoal = (key) => {
  const v = state.goals[key];
  const unit = GOALS[key].unit;
  if (unit === 'h') return fmtDuration(v * HOUR, true);
  if (unit === 'eur') return fmtMoney(v);
  return `${v}×`;
};

// ---------- Game layer ----------

const XP = { perHour: 10, perTraining: 50, perTenEuro: 1, perSleepGoal: 20 };

function totalXp() {
  const workMs = allSessions().reduce((s, x) => s + (x.end - x.start), 0);
  const earned = state.income.reduce((s, e) => s + Math.max(0, e.amount), 0);
  const sleepHits = state.sleep.filter((e) => e.minutes >= state.goals.sleepNight * 60).length;
  return Math.floor(
    (workMs / HOUR) * XP.perHour
    + state.trainings.length * XP.perTraining
    + (earned / 10) * XP.perTenEuro
    + sleepHits * XP.perSleepGoal,
  );
}

// Level L starts at 50·L·(L−1) XP: 0, 100, 300, 600, 1000 …
const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
const xpAtLevel = (level) => 50 * level * (level - 1);

function rankFor(level) {
  if (level >= 35) return 'LEGEND';
  if (level >= 20) return 'ELITE';
  if (level >= 10) return 'LOCKED IN';
  if (level >= 5) return 'GRINDER';
  return 'ROOKIE';
}

function activeDays() {
  return new Set([
    ...allSessions().map((s) => dayKey(s.start)),
    ...state.trainings.map((t) => dayKey(new Date(t.date))),
  ]);
}

function streak() {
  const active = activeDays();
  let day = startOfDay();
  if (!active.has(dayKey(day))) day = addDays(day, -1); // today still counts as open
  let n = 0;
  while (active.has(dayKey(day))) { n += 1; day = addDays(day, -1); }
  return n;
}

function longestStreak() {
  const days = [...activeDays()].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of days) {
    const d = new Date(`${key}T12:00`);
    run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// Body: rolling windows so the character doesn't shrink every Monday.
// Muscle = how close you were to your goals in the last 7 / 30 days (exceeding them counts extra).
// Energy = last night's sleep + work over the last 3 days.
function bodyScores() {
  const now = new Date();
  const g = state.goals;
  const cap = (v, max = 1.5) => Math.min(max, v);
  const work7 = workedBetween(new Date(now - 7 * DAY)) / (g.workWeek * HOUR);
  const train7 = countSince(state.trainings, new Date(now - 7 * DAY)) / g.trainWeek;
  const income30 = incomeSince(new Date(now - 30 * DAY)) / g.incomeMonth;
  const nights = sleepSince(addDays(startOfDay(), -6)).map((e) => e.minutes);
  const sleep7 = nights.length ? avg(nights) / (g.sleepNight * 60) : 0.7;
  const score = 0.3 * cap(train7) + 0.3 * cap(work7) + 0.2 * cap(income30) + 0.2 * cap(sleep7, 1.2);
  const muscle = Math.min(1, score / 1.15);

  const today = state.sleep.find((e) => e.day === dayKey(now)) || state.sleep.find((e) => e.day === dayKey(addDays(now, -1)));
  const sleepLast = today ? today.minutes / (g.sleepNight * 60) : 0.7;
  const work3 = workedBetween(addDays(startOfDay(), -2)) / (3 * g.workDay * HOUR);
  const energy = Math.min(1, 0.65 * Math.min(1.1, sleepLast) + 0.35 * Math.min(1, work3));
  return { muscle, energy };
}

// ---------- Formatting ----------

function fmtDuration(ms, compact = false) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (compact) return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
};
const fmtMoney = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 });
const fmtInt = (n) => n.toLocaleString('de-DE');
const fmtDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const fmtMonth = (key) => new Date(`${key}-01T12:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const todayInput = () => dayKey(new Date());
// A picked date means "that day"; if it's today keep the current time so the log stays in order.
const dateFromInput = (value) => (value === todayInput() ? new Date() : new Date(`${value}T12:00`));

// ---------- Dashboard rendering ----------

const PENCIL = '<svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.8 10l-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z"/></svg>';

function statTile({ kind, chipText, label, value, progress, goalKey, goalText }) {
  const tile = el('article', { className: 'stat' });
  tile.dataset.kind = kind;
  const pct = Math.min(100, Math.max(0, progress * 100 || 0));
  tile.innerHTML = `
    <div class="stat-head"><span class="chip"></span><span class="stat-label"></span></div>
    <p class="stat-value mono"></p>
    <div class="meter"><div class="meter-fill${pct >= 100 ? ' done' : ''}" style="width:${pct}%"></div></div>`;
  tile.querySelector('.chip').textContent = chipText;
  tile.querySelector('.stat-label').textContent = label;
  tile.querySelector('.stat-value').textContent = value;
  const goal = el('button', { type: 'button', className: 'stat-goal', title: 'Ziel ändern' });
  goal.innerHTML = `<span></span>${PENCIL}`;
  goal.firstChild.textContent = goalText ?? `Ziel ${fmtGoal(goalKey)}`;
  goal.onclick = () => openGoalDialog(goalKey);
  tile.append(goal);
  return tile;
}

function renderStats() {
  const s = computeStats();
  const g = state.goals;
  const sleepGoalMin = g.sleepNight * 60;
  $('#stats').replaceChildren(
    statTile({ kind: 'work', chipText: 'Arbeit', label: 'Heute', value: fmtDuration(s.workDay), progress: s.workDay / (g.workDay * HOUR), goalKey: 'workDay' }),
    statTile({ kind: 'work', chipText: 'Arbeit', label: 'Woche', value: fmtDuration(s.workWeek), progress: s.workWeek / (g.workWeek * HOUR), goalKey: 'workWeek' }),
    statTile({ kind: 'work', chipText: 'Arbeit', label: 'Monat', value: fmtDuration(s.workMonth), progress: s.workMonth / (g.workMonth * HOUR), goalKey: 'workMonth' }),
    statTile({ kind: 'money', chipText: 'Geld', label: 'Monat', value: fmtMoney(s.incomeMonth), progress: s.incomeMonth / g.incomeMonth, goalKey: 'incomeMonth' }),
    statTile({ kind: 'train', chipText: 'Training', label: 'Woche', value: `${s.trainWeek}×`, progress: s.trainWeek / g.trainWeek, goalKey: 'trainWeek' }),
    statTile({ kind: 'train', chipText: 'Training', label: 'Monat', value: `${s.trainMonth}×`, progress: s.trainMonth / g.trainMonth, goalKey: 'trainMonth' }),
    statTile({ kind: 'sleep', chipText: 'Schlaf', label: 'Letzte Nacht', value: s.sleepNight === null ? '–' : fmtDuration(s.sleepNight * 60000), progress: (s.sleepNight ?? 0) / sleepGoalMin, goalKey: 'sleepNight' }),
    statTile({ kind: 'sleep', chipText: 'Schlaf', label: 'Ø 7 Tage', value: s.sleepAvg ? fmtDuration(s.sleepAvg * 60000) : '–', progress: s.sleepAvg / sleepGoalMin, goalKey: 'sleepNight' }),
  );
}

let lastBody = '';
function renderPlayer() {
  const xp = totalXp();
  const level = levelFor(xp);
  const base = xpAtLevel(level);
  const next = xpAtLevel(level + 1);
  $('#playerName').textContent = state.name;
  $('#level').textContent = level;
  $('#rank').textContent = rankFor(level);
  $('#xpFill').style.width = `${((xp - base) / (next - base)) * 100}%`;
  $('#xpText').textContent = `${fmtInt(xp - base)} / ${fmtInt(next - base)} XP`;
  $('#xpTotal').textContent = `${fmtInt(xp)} XP gesamt`;
  $('#streakVal').textContent = streak();

  const { muscle, energy } = bodyScores();
  // Only redraw the SVG when the body visibly changes, so the idle animation keeps running smoothly.
  const bodyKey = `${muscle.toFixed(2)}|${energy.toFixed(2)}`;
  if (bodyKey !== lastBody) {
    $('#character').innerHTML = renderCharacter(muscle, energy);
    lastBody = bodyKey;
  }
  const mood = characterState(muscle, energy);
  $('#mood').textContent = mood.label.toUpperCase();
  $('#mood').classList.toggle('low', energy < 0.45);
  $('#moodHint').textContent = mood.hint;
  $('#formFill').style.width = `${Math.round(muscle * 100)}%`;
  $('#formVal').textContent = `${Math.round(muscle * 100)}%`;
  $('#energyFill').style.width = `${Math.round(energy * 100)}%`;
  $('#energyVal').textContent = `${Math.round(energy * 100)}%`;
  return level;
}

function renderTimer() {
  const running = Boolean(state.activeSession);
  $('#timer').textContent = running ? fmtClock(Date.now() - new Date(state.activeSession.start)) : '00:00:00';
  $('#session').classList.toggle('running', running);
  $('#workBtn').textContent = running ? 'Stop' : 'Start';
  $('#workBtn').classList.toggle('btn-stop', running);
  $('#livePill').hidden = !running;
}

function renderChart() {
  const chart = $('#chart');
  const week = startOfWeek();
  const today = startOfDay();
  const days = DAY_NAMES.map((name, i) => {
    const from = addDays(week, i);
    return { name, from, ms: workedBetween(from, addDays(week, i + 1)) };
  });
  const goal = state.goals.workDay * HOUR;
  const max = Math.max(goal * 1.25, ...days.map((d) => d.ms)) || 1;

  chart.replaceChildren();
  for (const d of days) {
    const col = el('div', { className: 'bar-col' });
    if (d.from > today) col.classList.add('future');
    if (+d.from === +today) col.classList.add('today');
    const bar = el('div', { className: 'bar' });
    bar.style.height = `${(d.ms / max) * 100}%`;
    const line = el('div', { className: 'goal-line' });
    line.style.bottom = `${(goal / max) * 100}%`;
    col.append(el('div', { className: 'bar-track' }, line, bar), el('div', { className: 'bar-day mono', textContent: d.name }));
    col.addEventListener('pointerenter', () => showTip(col, `${d.name} ${fmtDate(d.from)} · ${fmtDuration(d.ms)}`));
    col.addEventListener('pointerleave', hideTip);
    chart.append(col);
  }
  $('#chartTotal').textContent = `${fmtDuration(days.reduce((s, d) => s + d.ms, 0))} · Linie = Tagesziel`;
}

function showTip(col, text) {
  const tip = $('#tooltip');
  const card = col.closest('.chart-card').getBoundingClientRect();
  const bar = col.querySelector('.bar').getBoundingClientRect();
  const track = col.querySelector('.bar-track').getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${bar.left + bar.width / 2 - card.left}px`;
  tip.style.top = `${Math.min(bar.top, track.bottom - 4) - card.top - 8}px`;
}
const hideTip = () => { $('#tooltip').hidden = true; };

function allEntries() {
  return [
    ...state.sessions.map((e) => ({ id: e.id, kind: 'sessions', cls: 'work', at: e.start, text: `${fmtDuration(new Date(e.end) - new Date(e.start))} gearbeitet` })),
    ...state.income.map((e) => ({ id: e.id, kind: 'income', cls: 'money', at: e.date, text: fmtMoney(e.amount) + (e.note ? ` · ${e.note}` : '') })),
    ...state.trainings.map((e) => ({ id: e.id, kind: 'trainings', cls: 'train', at: e.date, text: e.note || 'Training' })),
    ...state.sleep.map((e) => ({ id: e.id, kind: 'sleep', cls: 'sleep', at: `${e.day}T08:00`, text: `${fmtDuration(e.minutes * 60000)} geschlafen` })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
}

function logItem(e) {
  const li = el('li');
  li.dataset.kind = e.cls;
  const del = el('button', { className: 'del', textContent: '×', title: 'Löschen' });
  del.setAttribute('aria-label', 'Eintrag löschen');
  del.onclick = async () => {
    if (!confirm('Eintrag löschen?')) return;
    await guard(() => api(`/api/${e.kind}/${e.id}`, { method: 'DELETE' }));
    refresh();
  };
  li.append(
    el('span', { className: 'chip' }),
    el('span', { className: 'what', textContent: e.text }),
    el('span', { className: 'when mono', textContent: fmtDate(e.at) }),
    del,
  );
  return li;
}

function renderLog() {
  const entries = allEntries().slice(0, 30);
  const log = $('#log');
  log.replaceChildren(...(entries.length
    ? entries.map(logItem)
    : [el('li', { className: 'empty', textContent: 'Noch nichts getrackt. Starte deine erste Session.' })]));
}

function renderSettings() {
  const f = $('#settingsForm');
  f.name.value = state.name;
  for (const [key, meta] of Object.entries(GOALS)) {
    f[key].value = meta.unit === 'h' ? hoursToInput(state.goals[key]) : state.goals[key];
  }
}

// ---------- Lifetime rendering ----------

function renderLifetime() {
  const workMs = allSessions().reduce((s, x) => s + (x.end - x.start), 0);
  const income = state.income.reduce((s, e) => s + e.amount, 0);
  const nights = state.sleep.map((e) => e.minutes);
  const sleepHits = state.sleep.filter((e) => e.minutes >= state.goals.sleepNight * 60).length;
  const dates = allEntries().map((e) => new Date(e.at));
  const first = dates.length ? new Date(Math.min(...dates)) : null;
  const xp = totalXp();

  const tile = (kind, chip, label, value, sub) => {
    const t = el('article', { className: 'stat' });
    t.dataset.kind = kind;
    t.innerHTML = '<div class="stat-head"><span class="chip"></span><span class="stat-label"></span></div><p class="stat-value mono"></p><p class="stat-goal static"></p>';
    t.querySelector('.chip').textContent = chip;
    t.querySelector('.stat-label').textContent = label;
    t.querySelector('.stat-value').textContent = value;
    t.querySelector('.stat-goal').textContent = sub;
    return t;
  };
  $('#lifetimeStats').replaceChildren(
    tile('work', 'Arbeit', 'Gesamt', fmtDuration(workMs), `${state.sessions.length} Sessions`),
    tile('money', 'Geld', 'Gesamt', fmtMoney(income), `${state.income.length} Einträge`),
    tile('train', 'Training', 'Gesamt', `${state.trainings.length}×`, `Längster Streak ${longestStreak()} Tage`),
    tile('sleep', 'Schlaf', 'Ø pro Nacht', nights.length ? fmtDuration(avg(nights) * 60000) : '–', `${nights.length} Nächte · ${sleepHits}× Ziel erreicht`),
    tile('work', 'Level', rankFor(levelFor(xp)), `LVL ${levelFor(xp)}`, `${fmtInt(xp)} XP gesamt`),
    tile('train', 'Aktiv', 'Tage', `${activeDays().size}`, `Aktueller Streak ${streak()} Tage`),
    tile('money', 'Geld', 'Ø pro Monat', fmtMoney(monthsTracked() ? income / monthsTracked() : 0), `über ${monthsTracked()} Monate`),
    tile('work', 'Arbeit', 'Ø pro Woche', fmtDuration(first ? workMs / Math.max(1, (Date.now() - startOfWeek(first)) / (7 * DAY)) : 0), 'seit Start'),
  );
  $('#sinceLabel').textContent = first ? `seit ${first.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'noch keine Daten';

  // Per-month table
  const months = new Map();
  const bucket = (key) => {
    if (!months.has(key)) months.set(key, { work: 0, income: 0, trainings: 0, sleep: [] });
    return months.get(key);
  };
  for (const s of allSessions()) bucket(monthKey(s.start)).work += s.end - s.start;
  for (const e of state.income) bucket(monthKey(new Date(e.date))).income += e.amount;
  for (const e of state.trainings) bucket(monthKey(new Date(e.date))).trainings += 1;
  for (const e of state.sleep) bucket(e.day.slice(0, 7)).sleep.push(e.minutes);
  const rows = [...months.entries()].sort(([a], [b]) => b.localeCompare(a));
  $('#monthRows').replaceChildren(...(rows.length ? rows.map(([key, m]) => {
    const tr = el('tr');
    for (const text of [fmtMonth(key), fmtDuration(m.work), fmtMoney(m.income), `${m.trainings}×`, m.sleep.length ? fmtDuration(avg(m.sleep) * 60000) : '–']) {
      tr.append(el('td', { textContent: text }));
    }
    return tr;
  }) : [el('tr', {}, el('td', { textContent: 'Noch keine Daten', colSpan: 5 }))]));

  renderFullLog();
}

const monthsTracked = () => {
  const keys = new Set(allEntries().map((e) => monthKey(new Date(e.at))));
  return keys.size;
};

let logFilter = 'all';
function renderFullLog() {
  const entries = allEntries().filter((e) => logFilter === 'all' || e.cls === logFilter);
  const list = $('#fullLog');
  list.replaceChildren();
  if (!entries.length) {
    list.append(el('li', { className: 'empty', textContent: 'Keine Einträge.' }));
    return;
  }
  let current = '';
  for (const e of entries) {
    const key = monthKey(new Date(e.at));
    if (key !== current) {
      current = key;
      list.append(el('li', { className: 'month-head', textContent: fmtMonth(key) }));
    }
    list.append(logItem(e));
  }
}

$$('.filter').forEach((btn) => {
  btn.onclick = () => {
    logFilter = btn.dataset.filter;
    $$('.filter').forEach((b) => b.classList.toggle('active', b === btn));
    renderFullLog();
  };
});

// ---------- Views ----------

function currentView() {
  return location.hash === '#lifetime' ? 'lifetime' : 'dashboard';
}

function showView() {
  const view = currentView();
  $('#view-dashboard').hidden = view !== 'dashboard';
  $('#view-lifetime').hidden = view !== 'lifetime';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (state && view === 'lifetime') renderLifetime();
  scrollTo({ top: 0 });
}
addEventListener('hashchange', showView);

let lastLevel = null;
function renderAll() {
  renderStats();
  const level = renderPlayer();
  renderTimer();
  renderChart();
  renderLog();
  renderSettings();
  if (currentView() === 'lifetime') renderLifetime();
  if (lastLevel !== null && level > lastLevel) celebrate(level);
  lastLevel = level;
}

// ---------- Feedback ----------

let toastTimer;
function toast(msg, { error = false, xp = 0 } = {}) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (xp > 0) t.append(el('span', { className: 'xp-gain', textContent: `+${fmtInt(xp)} XP` }));
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function celebrate(level) {
  const overlay = el('div', { className: 'level-up' }, el('p', { textContent: 'LEVEL UP' }), el('strong', { textContent: level }));
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), 2700);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, { error: true });
    throw err;
  }
}

// Runs an action and reports how much XP it earned.
async function withXp(action, message) {
  const before = totalXp();
  await action();
  await refresh();
  toast(message, { xp: totalXp() - before });
}

// ---------- Goal dialog ----------

let editingGoal = null;
function openGoalDialog(key) {
  const meta = GOALS[key];
  editingGoal = key;
  const f = $('#goalForm');
  $('#goalDialog').dataset.kind = meta.kind;
  $('#goalKind').textContent = 'Ziel ändern';
  $('#goalTitle').textContent = meta.title;
  f.value.value = meta.unit === 'h' ? hoursToInput(state.goals[key]) : state.goals[key];
  $('#goalHint').textContent = meta.unit === 'h' ? 'Format: 9:30 oder 9,5' : meta.unit === 'eur' ? 'Betrag in Euro' : 'Anzahl';
  $('#goalDialog').showModal();
  f.value.select();
}

$('#goalDialog').addEventListener('close', async () => {
  if ($('#goalDialog').returnValue !== 'save' || !editingGoal) return;
  const key = editingGoal;
  const raw = $('#goalForm').value.value;
  const value = GOALS[key].unit === 'h' ? parseHours(raw) : Number(String(raw).replace(',', '.'));
  if (!(value > 0)) return toast('Ungültiger Wert', { error: true });
  await guard(() => api('/api/settings', { method: 'PUT', body: { goals: { [key]: value } } }));
  await refresh();
  toast(`${GOALS[key].title}: ${fmtGoal(key)}`);
});

// ---------- Actions ----------

$('#workBtn').onclick = async () => {
  if (state.activeSession) {
    const ms = Date.now() - new Date(state.activeSession.start);
    await guard(() => api('/api/work/stop', { method: 'POST' }));
    await refresh();
    toast(`Session beendet · ${fmtDuration(ms)}`, { xp: Math.floor((ms / HOUR) * XP.perHour) });
  } else {
    await guard(() => api('/api/work/start', { method: 'POST' }));
    await refresh();
    toast('Session gestartet. Lock in.');
  }
};

$('#sleepForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const minutes = Number(f.h.value) * 60 + Number(f.m.value || 0);
  await guard(() => withXp(
    () => api('/api/sleep', { method: 'POST', body: { day: f.date.value, date: new Date(`${f.date.value}T08:00`), minutes } }),
    `${fmtDuration(minutes * 60000)} Schlaf eingetragen`,
  ));
  f.h.value = '';
  f.m.value = '';
};

$('#trainingForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await guard(() => withXp(
    () => api('/api/trainings', { method: 'POST', body: { note: f.note.value, date: dateFromInput(f.date.value) } }),
    'Training eingetragen',
  ));
  f.note.value = '';
};

$('#incomeForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const amount = Number(f.amount.value);
  await guard(() => withXp(
    () => api('/api/income', { method: 'POST', body: { amount, note: f.note.value, date: dateFromInput(f.date.value) } }),
    `${fmtMoney(amount)} eingetragen`,
  ));
  f.amount.value = '';
  f.note.value = '';
};

$('#sessionForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const hours = parseHours(f.hours.value);
  if (!(hours > 0 && hours <= 24)) return toast('Zeit z. B. als 2:30 oder 2,5 eingeben', { error: true });
  const start = new Date(`${f.date.value}T09:00`);
  const end = new Date(start.getTime() + hours * HOUR);
  await guard(() => withXp(
    () => api('/api/sessions', { method: 'POST', body: { start, end } }),
    `${fmtDuration(hours * HOUR)} nachgetragen`,
  ));
  f.hours.value = '';
};

$('#settingsForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const goals = {};
  for (const [key, meta] of Object.entries(GOALS)) {
    const value = meta.unit === 'h' ? parseHours(f[key].value) : Number(f[key].value);
    if (!(value > 0)) return toast(`Ungültiger Wert: ${meta.title}`, { error: true });
    goals[key] = value;
  }
  await guard(() => api('/api/settings', { method: 'PUT', body: { name: f.name.value, goals } }));
  await refresh();
  toast('Gespeichert');
};

// ---------- Boot ----------

// The timer ticks every second; stat tiles only re-render once a minute so they stay clickable.
let lastMinute = 0;
function tick() {
  if (!state) return;
  renderTimer();
  const minute = Math.floor(Date.now() / 60000);
  if (state.activeSession && minute !== lastMinute && currentView() === 'dashboard') {
    renderStats();
    renderPlayer();
  }
  lastMinute = minute;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7);
}

async function boot() {
  for (const form of ['#incomeForm', '#trainingForm', '#sessionForm', '#sleepForm']) $(form).date.value = todayInput();
  const now = new Date();
  $('#today').textContent = now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' });
  $('#periodLabel').textContent = `KW ${isoWeek(now)} · ${now.toLocaleDateString('de-DE', { month: 'long' })}`;
  showView();
  await guard(refresh);
  setInterval(tick, 1000);
  setInterval(() => state && renderChart(), 60_000);
}

boot();
