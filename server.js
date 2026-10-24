import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PASSWORD = process.env.APP_PASSWORD || '';

const COLLECTIONS = ['sessions', 'income', 'trainings', 'sleep', 'rewards'];

// Hours for work and sleep, euros for income, counts for training.
const DEFAULT_GOALS = {
  workDay: 8,
  workWeek: 40,
  workMonth: 160,
  incomeMonth: 5000,
  trainWeek: 3,
  trainMonth: 12,
  sleepNight: 9.5,
};

// Goals from the first version (weekHours, monthIncome, weekTrainings) map onto the new keys.
function migrateGoals(old = {}) {
  const goals = { ...DEFAULT_GOALS };
  if (old.weekHours) Object.assign(goals, { workDay: old.weekHours / 5, workWeek: old.weekHours, workMonth: Math.round(old.weekHours * 4.33) });
  if (old.monthIncome) goals.incomeMonth = old.monthIncome;
  if (old.weekTrainings) Object.assign(goals, { trainWeek: old.weekTrainings, trainMonth: Math.round(old.weekTrainings * 4.33) });
  for (const key of Object.keys(DEFAULT_GOALS)) if (old[key] !== undefined) goals[key] = old[key];
  return goals;
}

const emptyDb = () => ({
  name: process.env.HERO_NAME || 'Player',
  goals: { ...DEFAULT_GOALS },
  activeSession: null,
  sessions: [],
  income: [],
  trainings: [],
  sleep: [],
  rewards: [],
});

// ---------- Storage: one JSON file, writes serialized to avoid lost updates ----------

async function loadDb() {
  try {
    const { media, ...stored } = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    const db = { ...emptyDb(), ...stored };
    db.goals = migrateGoals(stored.goals);
    return db;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDb();
    throw err;
  }
}

async function saveDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_FILE);
}

let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const db = await loadDb();
    const result = await fn(db);
    await saveDb(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const parseDate = (value, field) => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new HttpError(400, `Ungültiges Datum: ${field}`);
  return d.toISOString();
};

const cleanNote = (note) => String(note ?? '').trim().slice(0, 200);

// ---------- App ----------

const app = express();
app.disable('x-powered-by');

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Basic auth for everything (page and API) once APP_PASSWORD is set.
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (sameSecret(pass, PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Stats", charset="UTF-8"').status(401).send('Zutritt verweigert.');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json({ limit: '200kb' }));

const route = (handler) => async (req, res, next) => {
  try {
    res.json(await handler(req, res));
  } catch (err) {
    next(err);
  }
};

app.get('/api/state', route(async () => loadDb()));

app.put('/api/settings', route(async (req) => mutate((db) => {
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'Name fehlt');
    db.name = name;
  }
  for (const key of Object.keys(DEFAULT_GOALS)) {
    if (req.body.goals?.[key] === undefined) continue;
    const value = Number(req.body.goals[key]);
    if (!Number.isFinite(value) || value <= 0) throw new HttpError(400, `Ungültiges Ziel: ${key}`);
    db.goals[key] = value;
  }
  return { ok: true };
})));

app.post('/api/work/start', route(async () => mutate((db) => {
  if (db.activeSession) throw new HttpError(409, 'Einsatz läuft bereits');
  db.activeSession = { start: new Date().toISOString() };
  return db.activeSession;
})));

app.post('/api/work/stop', route(async () => mutate((db) => {
  if (!db.activeSession) throw new HttpError(409, 'Kein laufender Einsatz');
  const session = { id: crypto.randomUUID(), start: db.activeSession.start, end: new Date().toISOString() };
  db.sessions.push(session);
  db.activeSession = null;
  return session;
})));

app.post('/api/sessions', route(async (req) => mutate((db) => {
  const start = parseDate(req.body.start, 'start');
  const end = parseDate(req.body.end, 'end');
  const ms = new Date(end) - new Date(start);
  if (ms <= 0 || ms > 24 * 3600e3) throw new HttpError(400, 'Dauer muss zwischen 0 und 24 Stunden liegen');
  const session = { id: crypto.randomUUID(), start, end, note: cleanNote(req.body.note) };
  db.sessions.push(session);
  return session;
})));

app.post('/api/income', route(async (req) => mutate((db) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, 'Ungültiger Betrag');
  const entry = {
    id: crypto.randomUUID(),
    date: parseDate(req.body.date, 'date'),
    amount: Math.round(amount * 100) / 100,
    note: cleanNote(req.body.note),
  };
  db.income.push(entry);
  return entry;
})));

app.post('/api/trainings', route(async (req) => mutate((db) => {
  const entry = { id: crypto.randomUUID(), date: parseDate(req.body.date, 'date'), note: cleanNote(req.body.note) };
  db.trainings.push(entry);
  return entry;
})));

// One entry per night, keyed by the day you woke up. Logging the same day again replaces it.
app.post('/api/sleep', route(async (req) => mutate((db) => {
  const minutes = Math.round(Number(req.body.minutes));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new HttpError(400, 'Schlaf muss zwischen 0 und 24 Stunden liegen');
  const date = parseDate(req.body.date, 'date');
  const day = String(req.body.day ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Ungültiger Tag');
  db.sleep = db.sleep.filter((e) => e.day !== day);
  const entry = { id: crypto.randomUUID(), day, date, minutes };
  db.sleep.push(entry);
  return entry;
})));

// Rewards you give yourself when reaching a level.
app.post('/api/rewards', route(async (req) => mutate((db) => {
  const level = Number(req.body.level);
  if (!Number.isInteger(level) || level < 2 || level > 9999) throw new HttpError(400, 'Level muss eine ganze Zahl ab 2 sein');
  const text = cleanNote(req.body.text);
  if (!text) throw new HttpError(400, 'Belohnung fehlt');
  const entry = { id: crypto.randomUUID(), level, text, claimedAt: null };
  db.rewards.push(entry);
  return entry;
})));

app.patch('/api/rewards/:id', route(async (req) => mutate((db) => {
  const reward = db.rewards.find((r) => r.id === req.params.id);
  if (!reward) throw new HttpError(404, 'Belohnung nicht gefunden');
  reward.claimedAt = req.body.claimed ? new Date().toISOString() : null;
  return reward;
})));

app.delete('/api/:collection/:id', route(async (req) => mutate((db) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) throw new HttpError(404, 'Unbekannt');
  const before = db[collection].length;
  db[collection] = db[collection].filter((e) => e.id !== id);
  if (db[collection].length === before) throw new HttpError(404, 'Eintrag nicht gefunden');
  return { ok: true };
})));

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Serverfehler' : err.message });
});

await fs.mkdir(DATA_DIR, { recursive: true });
app.listen(PORT, () => {
  console.log(`Online: http://localhost:${PORT}`);
  console.log(`Passwortschutz: ${PASSWORD ? 'aktiv' : 'AUS (nur lokal ok!)'}`);
});
