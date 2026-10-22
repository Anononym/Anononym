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
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
const COLLECTIONS = ['sessions', 'income', 'trainings'];

const emptyDb = () => ({
  name: process.env.HERO_NAME || 'Bruce',
  activeSession: null,
  sessions: [],
  income: [],
  trainings: [],
  media: null,
});

// ---------- Storage: one JSON file, writes serialized to avoid lost updates ----------

async function loadDb() {
  try {
    return { ...emptyDb(), ...JSON.parse(await fs.readFile(DB_FILE, 'utf8')) };
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

// Basic auth for everything (page, API, media) once APP_PASSWORD is set.
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (sameSecret(pass, PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Batcave", charset="UTF-8"').status(401).send('Zutritt verweigert.');
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

app.get('/api/state', route(async () => {
  const db = await loadDb();
  return {
    ...db,
    features: { voice: Boolean(ELEVEN_KEY), alfred: Boolean(ANTHROPIC_KEY) },
  };
}));

app.put('/api/settings', route(async (req) => mutate((db) => {
  const name = String(req.body.name ?? '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Name fehlt');
  db.name = name;
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

app.delete('/api/:collection/:id', route(async (req) => mutate((db) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) throw new HttpError(404, 'Unbekannt');
  const before = db[collection].length;
  db[collection] = db[collection].filter((e) => e.id !== id);
  if (db[collection].length === before) throw new HttpError(404, 'Eintrag nicht gefunden');
  return { ok: true };
})));

// Photo or video of you. Body is the raw file, Content-Type tells us what it is.
app.post(
  '/api/media',
  express.raw({ type: Object.keys(MEDIA_TYPES), limit: '80mb' }),
  route(async (req) => {
    const ext = MEDIA_TYPES[req.headers['content-type']];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'Nur JPG, PNG, WEBP, MP4 oder WEBM');
    }
    const file = `hero-${Date.now()}.${ext}`;
    await fs.writeFile(path.join(DATA_DIR, file), req.body);
    return mutate(async (db) => {
      if (db.media?.file) await fs.rm(path.join(DATA_DIR, db.media.file), { force: true });
      db.media = { file, kind: ext === 'mp4' || ext === 'webm' ? 'video' : 'image' };
      return db.media;
    });
  }),
);

app.get('/media/:file', async (req, res, next) => {
  const db = await loadDb().catch(next);
  if (!db?.media || db.media.file !== req.params.file) return res.sendStatus(404);
  res.sendFile(path.join(DATA_DIR, db.media.file), { maxAge: '365d', immutable: true });
});

// Text-to-speech via ElevenLabs. Key stays on the server.
app.post('/api/speak', async (req, res, next) => {
  try {
    if (!ELEVEN_KEY) throw new HttpError(501, 'ElevenLabs nicht konfiguriert');
    const text = String(req.body.text ?? '').trim().slice(0, 800);
    if (!text) throw new HttpError(400, 'Kein Text');
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2 },
      }),
    });
    if (!upstream.ok) throw new HttpError(502, `ElevenLabs: ${upstream.status} ${await upstream.text()}`);
    res.set('Content-Type', 'audio/mpeg').send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    next(err);
  }
});

const ALFRED_PROMPT = (name, context) => `Du bist Alfred Pennyworth, der loyale, trocken-humorvolle britische Butler von ${name} (Batman).
Du sprichst Deutsch, siezt ${name} und nennst ihn "Master ${name}".
Deine Antworten werden laut vorgelesen: kurz (1-4 Sätze), keine Aufzählungen, kein Markdown, keine Emojis.
Du bist ehrlich und forderst ${name}, wenn er zu wenig arbeitet oder das Training schleifen lässt, bleibst dabei aber respektvoll und warm.
Erfinde keine Zahlen. Nutze nur die folgenden aktuellen Daten aus dem Batcomputer:

${context}`;

app.post('/api/alfred', route(async (req) => {
  if (!ANTHROPIC_KEY) throw new HttpError(501, 'Claude nicht konfiguriert');
  const db = await loadDb();
  const messages = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .slice(-20)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.at(-1)?.role !== 'user') throw new HttpError(400, 'Keine Frage');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: ALFRED_PROMPT(db.name, String(req.body.context ?? '').slice(0, 2000)),
      messages,
    }),
  });
  if (!upstream.ok) throw new HttpError(502, `Claude: ${upstream.status} ${await upstream.text()}`);
  const data = await upstream.json();
  const reply = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { reply: reply || `Verzeihung, Master ${db.name}, mir fehlen die Worte.` };
}));

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Serverfehler' : err.message });
});

await fs.mkdir(DATA_DIR, { recursive: true });
app.listen(PORT, () => {
  console.log(`Batcomputer online: http://localhost:${PORT}`);
  console.log(`  Stimme (ElevenLabs): ${ELEVEN_KEY ? 'aktiv' : 'aus -> Browser-Stimme'}`);
  console.log(`  Alfred (Claude):     ${ANTHROPIC_KEY ? 'aktiv' : 'aus'}`);
  console.log(`  Passwortschutz:      ${PASSWORD ? 'aktiv' : 'AUS (nur lokal ok!)'}`);
});
