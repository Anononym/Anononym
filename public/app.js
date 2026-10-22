const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = null;
let chatHistory = [];
let currentAudio = null;

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

// ---------- Time math (in the browser's local time zone) ----------

const HOUR = 3600e3;

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}
function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function allSessions() {
  const list = state.sessions.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  if (state.activeSession) list.push({ start: new Date(state.activeSession.start), end: new Date() });
  return list;
}

function workedSince(from) {
  const now = new Date();
  return allSessions().reduce((sum, s) => {
    const ms = Math.min(s.end, now) - Math.max(s.start, from);
    return sum + Math.max(0, ms);
  }, 0);
}

function countSince(list, from) {
  return list.filter((e) => new Date(e.date) >= from).length;
}

function computeStats() {
  const month = startOfMonth();
  return {
    today: workedSince(startOfDay()),
    week: workedSince(startOfWeek()),
    month: workedSince(month),
    money: state.income.filter((e) => new Date(e.date) >= month).reduce((s, e) => s + e.amount, 0),
    moneyCount: countSince(state.income, month),
    trainWeek: countSince(state.trainings, startOfWeek()),
    trainMonth: countSince(state.trainings, month),
  };
}

const fmtDuration = (ms) => {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
};
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
};
const fmtMoney = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 });
const fmtDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const spokenHours = (ms) => {
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60000);
  const min = m === 1 ? 'eine Minute' : `${m} Minuten`;
  const hrs = h === 1 ? 'eine Stunde' : `${h} Stunden`;
  if (h === 0) return min;
  return m ? `${hrs} und ${min}` : hrs;
};
const times = (n) => (n === 1 ? 'einmal' : `${n}-mal`);
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// A date picked in a form means "that day"; keep the current time if it's today so ordering stays natural.
const dateFromInput = (value) => {
  const now = new Date();
  return value === todayInput() ? now : new Date(`${value}T12:00`);
};

// ---------- Greeting / briefing ----------

function greetingText() {
  const h = new Date().getHours();
  const name = state.name;
  if (h >= 5 && h < 11) return `Guten Morgen, Master ${name}.`;
  if (h >= 11 && h < 18) return `Guten Tag, Master ${name}.`;
  if (h >= 18 && h < 23) return `Guten Abend, Master ${name}.`;
  return `Gotham schläft, Master ${name}. Sie offenbar nicht.`;
}

function briefingText() {
  const s = computeStats();
  const parts = [
    `Heute haben Sie ${spokenHours(s.today)} gearbeitet, diese Woche ${spokenHours(s.week)}, im Monat ${spokenHours(s.month)}.`,
    `Der Umsatz in diesem Monat liegt bei ${fmtMoney(s.money)}.`,
  ];
  if (s.trainWeek === 0) parts.push('Im Training waren Sie diese Woche noch nicht. Die Gauner von Gotham trainieren auch, Sir.');
  else parts.push(`Im Training waren Sie diese Woche ${times(s.trainWeek)}, diesen Monat ${times(s.trainMonth)}.`);
  if (state.activeSession) parts.push('Ein Einsatz läuft gerade.');
  return parts.join(' ');
}

function contextForAlfred() {
  const s = computeStats();
  const now = new Date();
  return [
    `Jetzt: ${now.toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
    `Arbeit heute: ${fmtDuration(s.today)}`,
    `Arbeit diese Woche (seit Montag): ${fmtDuration(s.week)}`,
    `Arbeit diesen Monat: ${fmtDuration(s.month)}`,
    `Umsatz diesen Monat: ${fmtMoney(s.money)} aus ${s.moneyCount} Einträgen`,
    `Trainings diese Woche: ${s.trainWeek}, diesen Monat: ${s.trainMonth}`,
    `Einsatz läuft gerade: ${state.activeSession ? 'ja, seit ' + new Date(state.activeSession.start).toLocaleTimeString('de-DE') : 'nein'}`,
  ].join('\n');
}

async function typeInto(el, text, speed = 28) {
  el.classList.add('cursor');
  el.textContent = '';
  for (const ch of text) {
    el.textContent += ch;
    await new Promise((r) => setTimeout(r, speed));
  }
  el.classList.remove('cursor');
}

// ---------- Voice ----------

function stopVoice() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis?.cancel();
  $('#stopVoice').hidden = true;
}

async function speak(text) {
  stopVoice();
  $('#stopVoice').hidden = false;
  try {
    if (!state.features.voice) throw new Error('no-voice');
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'TTS fehlgeschlagen');
    const url = URL.createObjectURL(await res.blob());
    currentAudio = new Audio(url);
    currentAudio.onended = () => { URL.revokeObjectURL(url); $('#stopVoice').hidden = true; };
    await currentAudio.play();
  } catch (err) {
    if (err.message !== 'no-voice') toast(err.message, true);
    // Fallback: browser voice
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = 0.95;
    u.pitch = 0.85;
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de')) || null;
    u.onend = () => { $('#stopVoice').hidden = true; };
    speechSynthesis.speak(u);
  }
}

async function runBriefing() {
  const greet = greetingText();
  const brief = briefingText();
  speak(`${greet} ${brief}`);
  await typeInto($('#greeting'), greet, 40);
  await typeInto($('#briefing'), brief, 14);
}

// ---------- Render ----------

function renderStats() {
  const s = computeStats();
  $('#sToday').textContent = fmtDuration(s.today);
  $('#sWeek').textContent = fmtDuration(s.week);
  $('#sMonth').textContent = fmtDuration(s.month);
  $('#sMoney').textContent = fmtMoney(s.money);
  $('#sMoneySub').textContent = s.moneyCount ? `aus ${s.moneyCount} Einträgen` : 'noch nichts eingetragen';
  $('#sTrainWeek').textContent = `${s.trainWeek}×`;
  $('#sTrainMonth').textContent = `${s.trainMonth}×`;
}

function renderTimer() {
  const running = Boolean(state.activeSession);
  $('#timer').textContent = running ? fmtClock(Date.now() - new Date(state.activeSession.start)) : '--:--:--';
  $('.timer').classList.toggle('running', running);
  $('#workBtn').textContent = running ? 'Einsatz beenden' : 'Einsatz starten';
  $('#workBtn').classList.toggle('btn-danger', running);
  $('#workBtn').classList.toggle('btn-primary', !running);
  $('#statusDot').classList.toggle('live', running);
}

function renderMedia() {
  const fig = $('#figure');
  fig.querySelectorAll('img, video').forEach((el) => el.remove());
  $('#figureEmpty').hidden = Boolean(state.media);
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
  }
  fig.append(el);
}

function renderLog() {
  const entries = [
    ...state.sessions.map((e) => ({ ...e, kind: 'sessions', tag: 'ARBEIT', at: e.start, text: fmtDuration(new Date(e.end) - new Date(e.start)) + (e.note ? ` · ${e.note}` : '') })),
    ...state.income.map((e) => ({ ...e, kind: 'income', tag: 'UMSATZ', at: e.date, text: fmtMoney(e.amount) + (e.note ? ` · ${e.note}` : '') })),
    ...state.trainings.map((e) => ({ ...e, kind: 'trainings', tag: 'TRAINING', at: e.date, text: e.note || 'Training' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);

  const log = $('#log');
  log.replaceChildren();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Einträge. Starte deinen ersten Einsatz.';
    log.append(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    const tag = Object.assign(document.createElement('span'), { className: `tag ${e.kind === 'income' ? 'money' : ''}`, textContent: e.tag });
    const what = Object.assign(document.createElement('span'), { className: 'what', textContent: e.text });
    const when = Object.assign(document.createElement('span'), { className: 'when', textContent: fmtDate(e.at) });
    const del = Object.assign(document.createElement('button'), { className: 'del', textContent: '×', title: 'Löschen' });
    del.onclick = async () => {
      if (!confirm('Eintrag löschen?')) return;
      await guard(() => api(`/api/${e.kind}/${e.id}`, { method: 'DELETE' }));
      refresh();
    };
    li.append(tag, what, when, del);
    log.append(li);
  }
}

function renderAll() {
  renderStats();
  renderTimer();
  renderMedia();
  renderLog();
  $('#nameForm').name.value = state.name;
  $('#featureInfo').textContent =
    `Stimme: ${state.features.voice ? 'ElevenLabs aktiv' : 'Browser-Stimme (ElevenLabs-Key fehlt)'} · ` +
    `Alfred-KI: ${state.features.alfred ? 'aktiv' : 'aus (Anthropic-Key fehlt)'}`;
  $('#alfredHint').textContent = state.features.alfred ? '' : 'Alfred-KI ist aus. Trage ANTHROPIC_API_KEY in der .env ein.';
}

// ---------- UI helpers ----------

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

// ---------- Actions ----------

$('#workBtn').onclick = async () => {
  const running = Boolean(state.activeSession);
  await guard(() => api(running ? '/api/work/stop' : '/api/work/start', { method: 'POST' }));
  await refresh();
  if (running) {
    const s = computeStats();
    const line = `Einsatz beendet. Heute stehen ${spokenHours(s.today)} auf der Uhr, Sir.`;
    toast(line);
    speak(line);
  } else {
    toast('Einsatz gestartet.');
    speak('Sehr wohl, Sir. Ich nehme die Zeit.');
  }
};

$('#sessionForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const start = new Date(`${f.date.value}T09:00`);
  const end = new Date(start.getTime() + Number(f.hours.value) * HOUR);
  await guard(() => api('/api/sessions', { method: 'POST', body: { start, end, note: 'nachgetragen' } }));
  f.reset();
  toast('Arbeitszeit gespeichert.');
  refresh();
};

$('#incomeForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await guard(() => api('/api/income', { method: 'POST', body: { amount: f.amount.value, note: f.note.value, date: dateFromInput(f.date.value) } }));
  toast(`${fmtMoney(Number(f.amount.value))} verbucht.`);
  f.reset();
  f.date.value = todayInput();
  refresh();
};

$('#trainingForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await guard(() => api('/api/trainings', { method: 'POST', body: { note: f.note.value, date: dateFromInput(f.date.value) } }));
  f.reset();
  f.date.value = todayInput();
  await refresh();
  const line = `Training verbucht. Das ${computeStats().trainWeek}. diese Woche, Sir.`;
  toast(line);
  speak(line);
};

$('#nameForm').onsubmit = async (ev) => {
  ev.preventDefault();
  await guard(() => api('/api/settings', { method: 'PUT', body: { name: ev.target.name.value } }));
  toast('Gespeichert.');
  refresh();
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
  // PNG keeps transparency (for cut-out photos), everything else becomes JPEG.
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
    toast('Neues Profil im Batcomputer gespeichert.');
    refresh();
  };
});

$('#briefBtn').onclick = runBriefing;
$('#stopVoice').onclick = stopVoice;

// ---------- Alfred chat ----------

function addMsg(role, text, extraClass = '') {
  const el = Object.assign(document.createElement('div'), { className: `msg ${role} ${extraClass}`, textContent: text });
  $('#chat').append(el);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return el;
}

async function askAlfred(question) {
  if (!question.trim()) return;
  addMsg('user', question);
  chatHistory.push({ role: 'user', content: question });
  if (!state.features.alfred) {
    const reply = 'Verzeihung, Sir. Ohne meinen Anthropic-Schlüssel bin ich stumm wie ein Grab. Tragen Sie ihn bitte in der .env ein.';
    addMsg('assistant', reply);
    chatHistory.pop();
    return;
  }
  const pending = addMsg('assistant', '…', 'thinking');
  try {
    const { reply } = await api('/api/alfred', { method: 'POST', body: { messages: chatHistory, context: contextForAlfred() } });
    pending.classList.remove('thinking');
    pending.textContent = reply;
    chatHistory.push({ role: 'assistant', content: reply });
    speak(reply);
  } catch (err) {
    pending.remove();
    chatHistory.pop();
    toast(err.message, true);
  }
}

$('#chatForm').onsubmit = (ev) => {
  ev.preventDefault();
  const q = ev.target.q.value;
  ev.target.q.value = '';
  askAlfred(q);
};

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const rec = new Recognition();
  rec.lang = 'de-DE';
  rec.interimResults = false;
  rec.onresult = (ev) => askAlfred(ev.results[0][0].transcript);
  rec.onend = () => $('#micBtn').classList.remove('listening');
  rec.onerror = (ev) => { if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast(`Mikrofon: ${ev.error}`, true); };
  $('#micBtn').onclick = () => {
    if ($('#micBtn').classList.contains('listening')) return rec.stop();
    stopVoice();
    $('#micBtn').classList.add('listening');
    rec.start();
  };
} else {
  $('#micBtn').onclick = () => toast('Spracheingabe geht in diesem Browser nicht. Nutze Chrome oder Safari.', true);
}

// ---------- Gotham atmosphere ----------

function startRain() {
  const canvas = $('#rain');
  const ctx = canvas.getContext('2d');
  let drops = [];
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    drops = Array.from({ length: Math.round(canvas.width / 9) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      len: 10 + Math.random() * 22,
      speed: 9 + Math.random() * 12,
    }));
  };
  resize();
  addEventListener('resize', resize);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(170,180,210,0.22)';
    ctx.lineWidth = devicePixelRatio;
    ctx.beginPath();
    for (const d of drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
      d.y += d.speed;
      d.x -= d.speed * 0.18;
      if (d.y > canvas.height) { d.y = -d.len; d.x = Math.random() * canvas.width * 1.2; }
    }
    ctx.stroke();
    requestAnimationFrame(frame);
  })();
}

function startLightning() {
  const flash = $('#flash');
  const strike = () => {
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    setTimeout(strike, 9000 + Math.random() * 16000);
  };
  setTimeout(strike, 4000);
}

function startParallax() {
  const hero = $('#hero');
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    $('#figure').style.transform = `translate(${x * -14}px, ${y * -6}px)`;
    $('.sky').style.transform = `translate(${x * 10}px, ${y * 6}px)`;
  });
}

function startClock() {
  const tick = () => {
    $('#clock').textContent = new Date().toLocaleTimeString('de-DE');
    if (state) {
      renderTimer();
      if (state.activeSession) renderStats();
    }
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- Boot ----------

async function boot() {
  for (const form of ['#incomeForm', '#trainingForm', '#sessionForm']) $(form).date.value = todayInput();
  startRain();
  startLightning();
  startParallax();
  startClock();

  const lines = $('#bootLines');
  const log = (text, ok) => {
    const p = document.createElement('div');
    p.innerHTML = `&gt; ${text} `;
    if (ok) p.append(Object.assign(document.createElement('span'), { className: 'ok', textContent: ok }));
    lines.append(p);
  };
  log('Verbinde mit Bathöhle …');
  try {
    await refresh();
    log('Datenbank', '[OK]');
    log('Stimmmodul', state.features.voice ? '[ELEVENLABS]' : '[BROWSER]');
    log('Alfred', state.features.alfred ? '[ONLINE]' : '[OFFLINE]');
  } catch (err) {
    log(`Fehler: ${err.message}`);
    return;
  }
  $('#bootBtn').onclick = () => {
    $('#boot').classList.add('off');
    runBriefing();
  };
}

boot();
