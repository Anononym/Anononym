const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let state = null;
let xp = null; // result of computeXp(), refreshed on every render

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
const daysInMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthKey = (d) => dayKey(d).slice(0, 7);
const sleepDate = (e) => new Date(`${e.day}T08:00`);

function allSessions() {
  const list = state.sessions.map((s) => ({ id: s.id, start: new Date(s.start), end: new Date(s.end) }));
  if (state.activeSession) list.push({ id: 'active', start: new Date(state.activeSession.start), end: new Date() });
  return list;
}

const workedBetween = (from, to = new Date()) =>
  allSessions().reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0);
const countSince = (list, from) => list.filter((e) => new Date(e.date) >= from).length;
const incomeSince = (from) => state.income.filter((e) => new Date(e.date) >= from).reduce((s, e) => s + e.amount, 0);
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
    sleepAvg: avg(state.sleep.filter((e) => sleepDate(e) >= addDays(startOfDay(), -6)).map((e) => e.minutes)),
  };
}

// ---------- XP ----------
//
// A perfect day is worth 500 XP, a level costs 1000 XP (= 2 perfect days).
// Work and training count against the weekly goal, money against the monthly goal,
// so a day off costs nothing as long as the period goal is met. Sleep counts per night.
// Everything above a goal earns half rate, up to twice the goal. Sleep has no bonus.

const XP_PER_LEVEL = 1000;
const PERFECT_DAY = 500;
const DAY_XP = { work: 200, sleep: 100, money: 100, train: 100 };
const CATS = [
  { key: 'work', label: 'Arbeit' },
  { key: 'sleep', label: 'Schlaf' },
  { key: 'money', label: 'Geld' },
  { key: 'train', label: 'Training' },
];

function rates(date = new Date()) {
  const g = state.goals;
  return {
    work: (DAY_XP.work * 7) / g.workWeek, // per hour
    train: (DAY_XP.train * 7) / g.trainWeek, // per training
    money: (DAY_XP.money * daysInMonth(date)) / g.incomeMonth, // per euro
  };
}

// Cumulative XP for reaching `x` in a period: full rate up to the goal, half rate up to 2× goal.
function curve(x, goal, rate) {
  const v = Math.max(0, x);
  return rate * Math.min(v, goal) + 0.5 * rate * Math.min(Math.max(v - goal, 0), goal);
}

function computeXp() {
  const g = state.goals;
  const byEntry = new Map();
  const byDay = new Map();
  const credit = (id, date, cat, amount) => {
    byEntry.set(id, (byEntry.get(id) || 0) + amount);
    const key = dayKey(date);
    if (!byDay.has(key)) byDay.set(key, { work: 0, sleep: 0, money: 0, train: 0 });
    byDay.get(key)[cat] += amount;
  };
  // Walks entries in time order; each one earns the XP between the period total before and after it.
  const walk = (items, cat, periodOf, goalOf, rateOf) => {
    const used = new Map();
    for (const item of [...items].sort((a, b) => a.date - b.date)) {
      const period = periodOf(item.date);
      const before = used.get(period) || 0;
      const after = before + item.amount;
      used.set(period, after);
      const goal = goalOf(item.date);
      const rate = rateOf(item.date);
      credit(item.id, item.date, cat, curve(after, goal, rate) - curve(before, goal, rate));
    }
  };
  const weekOf = (d) => dayKey(startOfWeek(d));

  walk(allSessions().map((s) => ({ id: s.id, date: s.start, amount: (s.end - s.start) / HOUR })),
    'work', weekOf, () => g.workWeek, (d) => rates(d).work);
  walk(state.trainings.map((t) => ({ id: t.id, date: new Date(t.date), amount: 1 })),
    'train', weekOf, () => g.trainWeek, (d) => rates(d).train);
  walk(state.income.map((e) => ({ id: e.id, date: new Date(e.date), amount: e.amount })),
    'money', monthKey, () => g.incomeMonth, (d) => rates(d).money);
  for (const e of state.sleep) {
    credit(e.id, sleepDate(e), 'sleep', DAY_XP.sleep * Math.min(1, e.minutes / (g.sleepNight * 60)));
  }

  const total = Math.round([...byDay.values()].reduce((s, d) => s + d.work + d.sleep + d.money + d.train, 0));
  return { total, byEntry, byDay, level: Math.floor(total / XP_PER_LEVEL) + 1 };
}

const dayXp = (key) => xp.byDay.get(key) || { work: 0, sleep: 0, money: 0, train: 0 };
const daySum = (d) => d.work + d.sleep + d.money + d.train;

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
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of [...activeDays()].sort()) {
    const d = new Date(`${key}T12:00`);
    run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// ---------- Goals ----------

// unit: 'h' = hours (stored as decimal hours), 'eur', 'x' = count
const GOALS = {
  workDay: { title: 'Arbeit pro Tag', unit: 'h' },
  workWeek: { title: 'Arbeit pro Woche', unit: 'h' },
  workMonth: { title: 'Arbeit pro Monat', unit: 'h' },
  incomeMonth: { title: 'Umsatz pro Monat', unit: 'eur' },
  trainWeek: { title: 'Trainings pro Woche', unit: 'x' },
  trainMonth: { title: 'Trainings pro Monat', unit: 'x' },
  sleepNight: { title: 'Schlaf pro Nacht', unit: 'h' },
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

// ---------- Formatting ----------

function fmtDuration(ms, compact = false) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (compact && !m) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
};
const fmtMoney = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 });
const fmtInt = (n) => Math.round(n).toLocaleString('de-DE');
const fmtXp = (n) => `${n >= 0 ? '+' : '−'}${fmtInt(Math.abs(n))} XP`;
const fmtDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const fmtMonth = (key) => new Date(`${key}-01T12:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const todayInput = () => dayKey(new Date());
// A picked date means "that day"; if it's today keep the current time so the log stays in order.
const dateFromInput = (value) => (value === todayInput() ? new Date() : new Date(`${value}T12:00`));

// ---------- Level bar ----------

const GIFT = '<svg viewBox="0 0 24 24"><path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM15 5a1 1 0 1 1 0 2h-2a2 2 0 0 1 2-2zM9 5a2 2 0 0 1 2 2H9a1 1 0 1 1 0-2zm2 15H7v-8h4zm0-10H5V9h6zm6 10h-4v-8h4zm2-10h-6V9h6z"/></svg>';

function renderLevel() {
  const { total, level } = xp;
  const into = total - (level - 1) * XP_PER_LEVEL;
  $('#playerName').textContent = state.name;
  $('#level').textContent = level;
  $('#xpFill').style.width = `${(into / XP_PER_LEVEL) * 100}%`;
  $('#xpText').textContent = `${fmtInt(into)} / ${fmtInt(XP_PER_LEVEL)} XP bis Level ${level + 1}`;
  $('#xpTotal').textContent = `${fmtInt(total)} XP gesamt`;
  $('#streakVal').textContent = streak();

  // Today's XP split by category
  const today = dayXp(dayKey(new Date()));
  const sum = daySum(today);
  const scale = Math.max(PERFECT_DAY, sum);
  $('#todayXp').textContent = `${fmtInt(sum)} / ${PERFECT_DAY}`;
  $('#todayBar').replaceChildren(...CATS.filter((c) => today[c.key] > 0).map((c) => {
    const seg = el('div', { className: 'seg', title: `${c.label}: ${fmtXp(today[c.key])}` });
    seg.dataset.kind = c.key;
    seg.style.width = `${(today[c.key] / scale) * 100}%`;
    return seg;
  }));
  $('#todayLegend').replaceChildren(...CATS.map((c) => {
    const item = el('span', {}, `${c.label} `, el('b', { textContent: fmtInt(today[c.key]) }), el('span', { className: 'muted', textContent: `/${DAY_XP[c.key]}` }));
    item.dataset.kind = c.key;
    return item;
  }));

  // Next reward: an unlocked unclaimed one first, otherwise the next locked one.
  const sorted = [...state.rewards].sort((a, b) => a.level - b.level);
  const ready = sorted.find((r) => r.level <= level && !r.claimedAt);
  const next = sorted.find((r) => r.level > level);
  const box = $('#nextReward');
  box.classList.toggle('ready', Boolean(ready));
  if (ready) {
    box.innerHTML = `<span class="gift">${GIFT}</span><div><strong></strong><span class="muted">Freigeschaltet mit Level ${ready.level}. Gönn es dir!</span></div>`;
    box.querySelector('strong').textContent = ready.text;
  } else if (next) {
    const missing = next.level * XP_PER_LEVEL - XP_PER_LEVEL - total;
    const days = Math.ceil(missing / PERFECT_DAY);
    box.innerHTML = `<span class="gift">${GIFT}</span><div><strong></strong><span class="muted"></span></div>`;
    box.querySelector('strong').textContent = `Level ${next.level}: ${next.text}`;
    box.querySelector('.muted').textContent = `noch ${fmtInt(missing)} XP · ≈ ${days} perfekte${days === 1 ? 'r' : ''} Tag${days === 1 ? '' : 'e'}`;
  } else {
    box.innerHTML = `<span class="gift">${GIFT}</span><div><strong>Keine Belohnung geplant</strong><span class="muted">Leg unten fest, was du dir bei welchem Level gönnst.</span></div>`;
  }
}

// ---------- Stats ----------

const PENCIL = '<svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.8 10l-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z"/></svg>';

function statTile({ kind, chipText, label, value, progress, goalKey }) {
  const tile = el('article', { className: 'stat' });
  tile.dataset.kind = kind;
  const pct = Math.min(100, Math.max(0, progress * 100 || 0));
  tile.innerHTML = `
    <div class="stat-head"><span class="chip"></span><span class="stat-label"></span></div>
    <p class="stat-value mono"></p>
    <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>`;
  tile.querySelector('.chip').textContent = chipText;
  tile.querySelector('.stat-label').textContent = label;
  tile.querySelector('.stat-value').textContent = value;
  const goal = el('button', { type: 'button', className: 'stat-goal', title: 'Ziel ändern' });
  goal.innerHTML = `<span></span>${PENCIL}`;
  goal.firstChild.textContent = `Ziel ${fmtGoal(goalKey)}`;
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

function renderRates() {
  const r = rates();
  $('#rateWork').textContent = `${fmtInt(r.work)} XP / h`;
  $('#rateTrain').textContent = `${fmtInt(r.train)} XP / Training`;
  $('#rateMoney').textContent = `${fmtInt(r.money * 100)} XP / 100 €`;
  $('#rateSleep').textContent = `bis ${DAY_XP.sleep} XP / Nacht`;
  $('#sessionRate').textContent = `${fmtInt(r.work)} XP pro Stunde · ${fmtInt(r.work / 2)} XP über dem Wochenziel`;
}

function renderTimer() {
  const running = Boolean(state.activeSession);
  $('#timer').textContent = running ? fmtClock(Date.now() - new Date(state.activeSession.start)) : '00:00:00';
  $('#session').classList.toggle('running', running);
  $('#workBtn').textContent = running ? 'Stop' : 'Start';
  $('#workBtn').classList.toggle('btn-stop', running);
  $('#livePill').hidden = !running;
}

// ---------- Chart: XP per day this week, stacked by category ----------

function renderChart() {
  const chart = $('#chart');
  const week = startOfWeek();
  const today = startOfDay();
  const days = DAY_NAMES.map((name, i) => {
    const from = addDays(week, i);
    const parts = dayXp(dayKey(from));
    return { name, from, parts, sum: daySum(parts) };
  });
  const max = Math.max(PERFECT_DAY * 1.2, ...days.map((d) => d.sum));

  chart.replaceChildren();
  for (const d of days) {
    const col = el('div', { className: 'bar-col' });
    if (d.from > today) col.classList.add('future');
    if (+d.from === +today) col.classList.add('today');
    const stack = el('div', { className: 'stack' });
    stack.style.height = `${(d.sum / max) * 100}%`;
    for (const c of CATS) {
      if (d.parts[c.key] <= 0) continue;
      const part = el('div', { className: 'part' });
      part.dataset.kind = c.key;
      part.style.flex = `${d.parts[c.key]} 0 0`;
      stack.append(part);
    }
    const line = el('div', { className: 'goal-line' });
    line.style.bottom = `${(PERFECT_DAY / max) * 100}%`;
    col.append(el('div', { className: 'bar-track' }, line, stack), el('div', { className: 'bar-day mono', textContent: d.name }));
    col.addEventListener('pointerenter', () => showTip(col, d));
    col.addEventListener('pointerleave', hideTip);
    chart.append(col);
  }
  if (!$('.chart-legend')) {
    const legend = el('div', { className: 'seg-legend chart-legend' }, ...CATS.map((c) => {
      const item = el('span', { textContent: c.label });
      item.dataset.kind = c.key;
      return item;
    }));
    chart.after(legend);
  }
  $('#chartTotal').textContent = `${fmtXp(days.reduce((s, d) => s + d.sum, 0))} · Linie = perfekter Tag`;
}

function showTip(col, d) {
  const tip = $('#tooltip');
  const card = col.closest('.chart-card').getBoundingClientRect();
  const track = col.querySelector('.bar-track').getBoundingClientRect();
  const stack = col.querySelector('.stack').getBoundingClientRect();
  tip.replaceChildren(
    el('b', { textContent: `${d.name} ${fmtDate(d.from)} · ${fmtXp(d.sum)}` }),
    ...CATS.filter((c) => d.parts[c.key] > 0).map((c) => el('div', { textContent: `${c.label} ${fmtXp(d.parts[c.key])}` })),
  );
  tip.hidden = false;
  tip.style.left = `${track.left + track.width / 2 - card.left}px`;
  tip.style.top = `${Math.min(stack.top, track.bottom - 4) - card.top - 8}px`;
}
const hideTip = () => { $('#tooltip').hidden = true; };

// ---------- Rewards ----------

function renderRewards() {
  const list = $('#rewards');
  const sorted = [...state.rewards].sort((a, b) => a.level - b.level);
  if (!sorted.length) {
    list.replaceChildren(el('li', { className: 'empty', textContent: 'Noch keine Belohnungen. Zum Beispiel: Level 5 → Essen gehen, Level 15 → neue Kopfhörer.' }));
    return;
  }
  list.replaceChildren(...sorted.map((r) => {
    const unlocked = r.level <= xp.level;
    const li = el('li', { className: r.claimedAt ? 'claimed unlocked' : unlocked ? 'unlocked' : '' });
    const missing = (r.level - 1) * XP_PER_LEVEL - xp.total;
    const status = r.claimedAt
      ? `Eingelöst am ${fmtDate(r.claimedAt)}`
      : unlocked ? 'Freigeschaltet' : `noch ${fmtInt(missing)} XP · ≈ ${Math.ceil(missing / PERFECT_DAY)} perfekte Tage`;
    const text = el('div', { className: 'r-text' }, el('strong', { textContent: r.text }), el('span', { textContent: status }));
    li.append(el('span', { className: 'r-lvl', textContent: `LVL ${r.level}` }), text);
    if (unlocked) {
      const btn = el('button', { className: 'btn btn-sm', type: 'button', textContent: r.claimedAt ? 'Rückgängig' : 'Einlösen' });
      btn.onclick = async () => {
        await guard(() => api(`/api/rewards/${r.id}`, { method: 'PATCH', body: { claimed: !r.claimedAt } }));
        refresh();
      };
      li.append(btn);
    }
    const del = el('button', { className: 'del', type: 'button', textContent: '×', title: 'Löschen' });
    del.setAttribute('aria-label', 'Belohnung löschen');
    del.onclick = async () => {
      if (!confirm('Belohnung löschen?')) return;
      await guard(() => api(`/api/rewards/${r.id}`, { method: 'DELETE' }));
      refresh();
    };
    li.append(del);
    return li;
  }));
}

$('#rewardForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await guard(() => api('/api/rewards', { method: 'POST', body: { level: Number(f.level.value), text: f.text.value } }));
  f.reset();
  await refresh();
  toast('Belohnung gespeichert');
};

// ---------- Log ----------

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
    el('span', { className: 'xp mono', textContent: fmtXp(xp.byEntry.get(e.id) || 0) }),
    el('span', { className: 'when mono', textContent: fmtDate(e.at) }),
    del,
  );
  return li;
}

function renderLog() {
  const entries = allEntries().slice(0, 30);
  $('#log').replaceChildren(...(entries.length
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

// ---------- Lifetime ----------

function renderLifetime() {
  const workMs = allSessions().reduce((s, x) => s + (x.end - x.start), 0);
  const income = state.income.reduce((s, e) => s + e.amount, 0);
  const nights = state.sleep.map((e) => e.minutes);
  const sleepHits = state.sleep.filter((e) => e.minutes >= state.goals.sleepNight * 60).length;
  const dates = allEntries().map((e) => new Date(e.at));
  const first = dates.length ? new Date(Math.min(...dates)) : null;
  const strongDays = [...xp.byDay.values()].filter((d) => daySum(d) >= PERFECT_DAY).length;

  const months = new Map();
  const bucket = (key) => {
    if (!months.has(key)) months.set(key, { xp: 0, work: 0, income: 0, trainings: 0, sleep: [] });
    return months.get(key);
  };
  for (const [key, d] of xp.byDay) bucket(key.slice(0, 7)).xp += daySum(d);
  for (const s of allSessions()) bucket(monthKey(s.start)).work += s.end - s.start;
  for (const e of state.income) bucket(monthKey(new Date(e.date))).income += e.amount;
  for (const e of state.trainings) bucket(monthKey(new Date(e.date))).trainings += 1;
  for (const e of state.sleep) bucket(e.day.slice(0, 7)).sleep.push(e.minutes);

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
  const weeks = first ? Math.max(1, (Date.now() - startOfWeek(first)) / (7 * DAY)) : 1;
  $('#lifetimeStats').replaceChildren(
    tile('work', 'Level', 'Aktuell', `LVL ${xp.level}`, `${fmtInt(xp.total)} XP gesamt`),
    tile('work', 'XP', 'Starke Tage', `${strongDays}`, `Tage mit ${PERFECT_DAY}+ XP`),
    tile('train', 'Aktiv', 'Tage', `${activeDays().size}`, `Streak ${streak()} · längster ${longestStreak()}`),
    tile('money', 'Belohnungen', 'Eingelöst', `${state.rewards.filter((r) => r.claimedAt).length}/${state.rewards.length}`, 'gönn dir'),
    tile('work', 'Arbeit', 'Gesamt', fmtDuration(workMs), `Ø ${fmtDuration(workMs / weeks)} pro Woche`),
    tile('money', 'Geld', 'Gesamt', fmtMoney(income), `Ø ${fmtMoney(months.size ? income / months.size : 0)} pro Monat`),
    tile('train', 'Training', 'Gesamt', `${state.trainings.length}×`, `Ø ${(state.trainings.length / weeks).toLocaleString('de-DE', { maximumFractionDigits: 1 })} pro Woche`),
    tile('sleep', 'Schlaf', 'Ø pro Nacht', nights.length ? fmtDuration(avg(nights) * 60000) : '–', `${nights.length} Nächte · ${sleepHits}× Ziel`),
  );
  $('#sinceLabel').textContent = first ? `seit ${first.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'noch keine Daten';

  const rows = [...months.entries()].sort(([a], [b]) => b.localeCompare(a));
  $('#monthRows').replaceChildren(...(rows.length ? rows.map(([key, m]) => {
    const tr = el('tr');
    for (const text of [fmtMonth(key), fmtInt(m.xp), fmtDuration(m.work), fmtMoney(m.income), `${m.trainings}×`, m.sleep.length ? fmtDuration(avg(m.sleep) * 60000) : '–']) {
      tr.append(el('td', { textContent: text }));
    }
    return tr;
  }) : [el('tr', {}, el('td', { textContent: 'Noch keine Daten', colSpan: 6 }))]));

  renderFullLog();
}

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

const currentView = () => (location.hash === '#lifetime' ? 'lifetime' : 'dashboard');

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
  xp = computeXp();
  renderLevel();
  renderStats();
  renderRates();
  renderTimer();
  renderChart();
  renderRewards();
  renderLog();
  renderSettings();
  if (currentView() === 'lifetime') renderLifetime();
  if (lastLevel !== null && xp.level > lastLevel) celebrate(lastLevel, xp.level);
  lastLevel = xp.level;
}

// ---------- Feedback ----------

let toastTimer;
function toast(msg, { error = false, gained = 0 } = {}) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (gained) t.append(el('span', { className: 'xp-gain', textContent: fmtXp(gained) }));
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function celebrate(from, to) {
  const unlocked = state.rewards.filter((r) => r.level > from && r.level <= to);
  const overlay = el('div', { className: 'level-up' }, el('p', { textContent: 'LEVEL UP' }), el('strong', { textContent: to }));
  for (const r of unlocked) overlay.append(el('div', { className: 'reward', textContent: `🎁 ${r.text}` }));
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), 3500);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, { error: true });
    throw err;
  }
}

// Runs an action and reports how much XP it earned in total (later entries can shift into bonus range).
async function withXp(action, message) {
  const before = xp.total;
  await action();
  await refresh();
  toast(message, { gained: xp.total - before });
}

// ---------- Goal dialog ----------

let editingGoal = null;
function openGoalDialog(key) {
  editingGoal = key;
  const meta = GOALS[key];
  const f = $('#goalForm');
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
    const earned = xp.byEntry.get('active') || 0;
    await guard(() => api('/api/work/stop', { method: 'POST' }));
    await refresh();
    toast(`Session beendet · ${fmtDuration(ms)}`, { gained: earned });
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

// The timer ticks every second; everything else re-renders once a minute during a session so it stays clickable.
let lastMinute = Math.floor(Date.now() / 60000);
function tick() {
  if (!state) return;
  renderTimer();
  const minute = Math.floor(Date.now() / 60000);
  if (state.activeSession && minute !== lastMinute && currentView() === 'dashboard') {
    xp = computeXp();
    renderLevel();
    renderStats();
    renderChart();
    if (xp.level > lastLevel) celebrate(lastLevel, xp.level);
    lastLevel = xp.level;
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
}

boot();
