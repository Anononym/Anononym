const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = null;

// ---------- API ----------

async function api(path, { method = 'GET', body, headers } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(path, {
    method,
    headers: isJson ? { 'Content-Type': 'application/json' } : headers,
    body: isJson ? JSON.stringify(body) : body,
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
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysInMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function allSessions() {
  const list = state.sessions.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  if (state.activeSession) list.push({ start: new Date(state.activeSession.start), end: new Date() });
  return list;
}

function workedBetween(from, to = new Date()) {
  return allSessions().reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0);
}

const countSince = (list, from) => list.filter((e) => new Date(e.date) >= from).length;

function computeStats() {
  const month = startOfMonth();
  const week = startOfWeek();
  return {
    today: workedBetween(startOfDay()),
    week: workedBetween(week),
    month: workedBetween(month),
    money: state.income.filter((e) => new Date(e.date) >= month).reduce((s, e) => s + e.amount, 0),
    trainWeek: countSince(state.trainings, week),
    trainMonth: countSince(state.trainings, month),
  };
}

function goals() {
  const g = state.goals;
  const monthWeeks = daysInMonth() / 7;
  return {
    today: (g.weekHours / 5) * HOUR,
    week: g.weekHours * HOUR,
    month: g.weekHours * monthWeeks * HOUR,
    money: g.monthIncome,
    trainWeek: g.weekTrainings,
    trainMonth: Math.round(g.weekTrainings * monthWeeks),
  };
}

// ---------- Game layer: XP, level, rank, streak ----------

const XP = { perHour: 10, perTraining: 50, perTenEuro: 1 };

function totalXp() {
  const workMs = allSessions().reduce((s, x) => s + (x.end - x.start), 0);
  const earned = state.income.reduce((s, e) => s + Math.max(0, e.amount), 0);
  return Math.floor(
    (workMs / HOUR) * XP.perHour + state.trainings.length * XP.perTraining + (earned / 10) * XP.perTenEuro,
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

function streak() {
  const active = new Set([
    ...allSessions().map((s) => dayKey(s.start)),
    ...state.trainings.map((t) => dayKey(new Date(t.date))),
  ]);
  let day = startOfDay();
  if (!active.has(dayKey(day))) day = addDays(day, -1); // today still counts as open
  let n = 0;
  while (active.has(dayKey(day))) { n += 1; day = addDays(day, -1); }
  return n;
}

// ---------- Formatting ----------

const fmtDuration = (ms) => {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
};
const fmtHours = (ms) => `${(ms / HOUR).toLocaleString('de-DE', { maximumFractionDigits: ms >= 10 * HOUR ? 0 : 1 })}h`;
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
};
const fmtMoney = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 });
const fmtInt = (n) => n.toLocaleString('de-DE');
const fmtDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// A picked date means "that day"; if it's today keep the current time so the log stays in order.
const dateFromInput = (value) => (value === todayInput() ? new Date() : new Date(`${value}T12:00`));

// ---------- Render ----------

function setMeter(id, value, goal) {
  const pct = Math.min(100, (value / goal) * 100 || 0);
  const el = $(id);
  el.style.width = `${pct}%`;
  el.classList.toggle('done', pct >= 100);
}

function renderStats() {
  const s = computeStats();
  const g = goals();
  $('#sToday').textContent = fmtDuration(s.today);
  $('#sWeek').textContent = fmtDuration(s.week);
  $('#sMonth').textContent = fmtDuration(s.month);
  $('#sMoney').textContent = fmtMoney(s.money);
  $('#sTrainWeek').textContent = `${s.trainWeek}×`;
  $('#sTrainMonth').textContent = `${s.trainMonth}×`;

  setMeter('#mToday', s.today, g.today);
  setMeter('#mWeek', s.week, g.week);
  setMeter('#mMonth', s.month, g.month);
  setMeter('#mMoney', s.money, g.money);
  setMeter('#mTrainWeek', s.trainWeek, g.trainWeek);
  setMeter('#mTrainMonth', s.trainMonth, g.trainMonth);

  $('#gToday').textContent = `Ziel ${fmtHours(g.today)}`;
  $('#gWeek').textContent = `Ziel ${fmtHours(g.week)}`;
  $('#gMonth').textContent = `Ziel ${fmtHours(g.month)}`;
  $('#gMoney').textContent = `Ziel ${fmtMoney(g.money)}`;
  $('#gTrainWeek').textContent = `Ziel ${g.trainWeek}×`;
  $('#gTrainMonth').textContent = `Ziel ${g.trainMonth}×`;
}

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
  return { xp, level };
}

function renderTimer() {
  const running = Boolean(state.activeSession);
  $('#timer').textContent = running ? fmtClock(Date.now() - new Date(state.activeSession.start)) : '00:00:00';
  $('#session').classList.toggle('running', running);
  $('#workBtn').textContent = running ? 'Stop' : 'Start';
  $('#workBtn').classList.toggle('btn-stop', running);
  $('#livePill').hidden = !running;
}

function renderMedia() {
  const box = $('#avatarMedia');
  box.querySelectorAll('img, video').forEach((el) => el.remove());
  $('#avatarEmpty').hidden = Boolean(state.media);
  if (!state.media) return;
  const src = `/media/${encodeURIComponent(state.media.file)}`;
  let el;
  if (state.media.kind === 'video') {
    el = document.createElement('video');
    Object.assign(el, { src, autoplay: true, loop: true, muted: true, playsInline: true });
  } else {
    el = document.createElement('img');
    el.src = src;
    el.alt = state.name;
    // Transparent PNGs (cut-out photos) stand on the glow ring instead of filling the frame.
    if (state.media.file.endsWith('.png')) el.classList.add('cutout');
  }
  box.prepend(el);
}

function renderChart() {
  const chart = $('#chart');
  const week = startOfWeek();
  const today = startOfDay();
  const days = DAY_NAMES.map((name, i) => {
    const from = addDays(week, i);
    return { name, from, ms: workedBetween(from, addDays(week, i + 1)) };
  });
  const goal = goals().today;
  const max = Math.max(goal * 1.25, ...days.map((d) => d.ms)) || 1;

  chart.replaceChildren();
  for (const d of days) {
    const col = document.createElement('div');
    col.className = 'bar-col';
    if (d.from > today) col.classList.add('future');
    if (+d.from === +today) col.classList.add('today');
    const track = Object.assign(document.createElement('div'), { className: 'bar-track' });
    const bar = Object.assign(document.createElement('div'), { className: 'bar' });
    bar.style.height = `${(d.ms / max) * 100}%`;
    const line = Object.assign(document.createElement('div'), { className: 'goal-line' });
    line.style.bottom = `${(goal / max) * 100}%`;
    track.append(line, bar);
    const label = Object.assign(document.createElement('div'), { className: 'bar-day mono', textContent: d.name });
    col.append(track, label);
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

function renderLog() {
  const entries = [
    ...state.sessions.map((e) => ({ ...e, kind: 'sessions', cls: 'work', at: e.start, text: `${fmtDuration(new Date(e.end) - new Date(e.start))} gearbeitet` })),
    ...state.income.map((e) => ({ ...e, kind: 'income', cls: 'money', at: e.date, text: fmtMoney(e.amount) + (e.note ? ` · ${e.note}` : '') })),
    ...state.trainings.map((e) => ({ ...e, kind: 'trainings', cls: 'train', at: e.date, text: e.note || 'Training' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 60);

  const log = $('#log');
  log.replaceChildren();
  if (!entries.length) {
    log.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Noch nichts getrackt. Starte deine erste Session.' }));
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.dataset.kind = e.cls;
    const chip = Object.assign(document.createElement('span'), { className: 'chip' });
    const what = Object.assign(document.createElement('span'), { className: 'what', textContent: e.text });
    const when = Object.assign(document.createElement('span'), { className: 'when mono', textContent: fmtDate(e.at) });
    const del = Object.assign(document.createElement('button'), { className: 'del', textContent: '×', title: 'Löschen' });
    del.setAttribute('aria-label', 'Eintrag löschen');
    del.onclick = async () => {
      if (!confirm('Eintrag löschen?')) return;
      await guard(() => api(`/api/${e.kind}/${e.id}`, { method: 'DELETE' }));
      refresh();
    };
    li.append(chip, what, when, del);
    log.append(li);
  }
}

function renderSettings() {
  const f = $('#settingsForm');
  f.name.value = state.name;
  f.weekHours.value = state.goals.weekHours;
  f.monthIncome.value = state.goals.monthIncome;
  f.weekTrainings.value = state.goals.weekTrainings;
}

let lastLevel = null;
function renderAll() {
  renderStats();
  const { level } = renderPlayer();
  renderTimer();
  renderMedia();
  renderChart();
  renderLog();
  renderSettings();
  if (lastLevel !== null && level > lastLevel) celebrate(level);
  lastLevel = level;
}

// ---------- Feedback ----------

let toastTimer;
function toast(msg, { error = false, xp = 0 } = {}) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (xp > 0) t.append(Object.assign(document.createElement('span'), { className: 'xp-gain', textContent: `+${fmtInt(xp)} XP` }));
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function celebrate(level) {
  const el = document.createElement('div');
  el.className = 'level-up';
  el.innerHTML = '<p>LEVEL UP</p><strong></strong>';
  el.querySelector('strong').textContent = level;
  document.body.append(el);
  setTimeout(() => el.remove(), 2700);
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

// ---------- Actions ----------

$('#workBtn').onclick = async () => {
  if (state.activeSession) {
    // Active time already counts toward XP live, so measure the session itself.
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
  const start = new Date(`${f.date.value}T09:00`);
  const end = new Date(start.getTime() + Number(f.hours.value) * HOUR);
  await guard(() => withXp(
    () => api('/api/sessions', { method: 'POST', body: { start, end } }),
    `${f.hours.value}h nachgetragen`,
  ));
  f.hours.value = '';
};

$('#settingsForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await guard(() => api('/api/settings', {
    method: 'PUT',
    body: {
      name: f.name.value,
      goals: { weekHours: f.weekHours.value, monthIncome: f.monthIncome.value, weekTrainings: f.weekTrainings.value },
    },
  }));
  await refresh();
  toast('Gespeichert');
};

// Shrink photos in the browser before upload; videos go up as-is.
async function prepareImage(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(img.width * scale),
    height: Math.round(img.height * scale),
  });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  // PNG keeps transparency (cut-out photos), everything else becomes JPEG.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

$$('[data-upload]').forEach((input) => {
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    toast('Lade hoch …');
    const blob = file.type.startsWith('image/') ? await prepareImage(file) : file;
    await guard(() => api('/api/media', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } }));
    await refresh();
    toast('Avatar aktualisiert');
  };
});
$('#avatarEmpty').onclick = () => $('.avatar-upload input').click();

// ---------- Boot ----------

function tick() {
  if (!state) return;
  renderTimer();
  if (state.activeSession) {
    renderStats();
    renderPlayer();
  }
}

async function boot() {
  for (const form of ['#incomeForm', '#trainingForm', '#sessionForm']) $(form).date.value = todayInput();
  const now = new Date();
  $('#today').textContent = now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' });
  $('#periodLabel').textContent = `KW ${isoWeek(now)} · ${now.toLocaleDateString('de-DE', { month: 'long' })}`;
  await guard(refresh);
  setInterval(tick, 1000);
  setInterval(renderChart, 60_000);
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7);
}

boot();
