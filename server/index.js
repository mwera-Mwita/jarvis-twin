require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fetch    = require('node-fetch');
const open     = require('open');
const Database = require('better-sqlite3');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── DATABASE SETUP (SQLite — unlimited memory, forever) ───────────────────────
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'jarvis.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    text      TEXT UNIQUE,
    created   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS insights (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    text      TEXT UNIQUE,
    created   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS traits (
    key       TEXT PRIMARY KEY,
    value     REAL DEFAULT 40
  );

  CREATE TABLE IF NOT EXISTS meta (
    key       TEXT PRIMARY KEY,
    value     TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    role      TEXT,
    content   TEXT,
    created   TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default traits if empty
const traitKeys = ['openness','assertiveness','empathy','logic','creativity','resilience'];
const insertTrait = db.prepare(`INSERT OR IGNORE INTO traits (key, value) VALUES (?, 40)`);
traitKeys.forEach(k => insertTrait.run(k));

// Meta helpers
const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
const setMeta = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

function getMetaVal(key, def = null) {
  const row = getMeta.get(key);
  return row ? row.value : def;
}

// Session counter
let sessions = parseInt(getMetaVal('sessions', '0')) + 1;
setMeta.run('sessions', String(sessions));
setMeta.run('last_seen', new Date().toISOString());

// ── HELPER: load full state from DB ──────────────────────────────────────────
function loadState() {
  const memories  = db.prepare(`SELECT text FROM memories ORDER BY id DESC LIMIT 60`).all().map(r => r.text);
  const insights  = db.prepare(`SELECT text FROM insights ORDER BY id DESC LIMIT 40`).all().map(r => r.text);
  const traitRows = db.prepare(`SELECT key, value FROM traits`).all();
  const traits    = {};
  traitRows.forEach(r => traits[r.key] = r.value);

  return {
    memories,
    insights,
    traits,
    sessions,
    exchanges:     parseInt(getMetaVal('exchanges', '0')),
    identityPhrase: getMetaVal('identity_phrase'),
    createdAt:     getMetaVal('created_at', new Date().toISOString()),
    lastSeen:      getMetaVal('last_seen'),
  };
}

// ── API: GET /api/state ───────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json(loadState());
});

// ── API: POST /api/chat ───────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── API: POST /api/memory ─────────────────────────────────────────────────────
app.post('/api/memory', (req, res) => {
  const { memory, insight, identityPhrase, traitDeltas, mood } = req.body;

  try {
    if (memory && memory !== 'null') {
      db.prepare(`INSERT OR IGNORE INTO memories (text) VALUES (?)`).run(memory);
    }
    if (insight && insight !== 'null') {
      db.prepare(`INSERT OR IGNORE INTO insights (text) VALUES (?)`).run(insight);
    }
    if (identityPhrase && identityPhrase !== 'null') {
      setMeta.run('identity_phrase', identityPhrase);
    }
    if (mood) setMeta.run('mood', mood);

    if (traitDeltas) {
      const updateTrait = db.prepare(`UPDATE traits SET value = MAX(5, MIN(95, value + ?)) WHERE key = ?`);
      Object.entries(traitDeltas).forEach(([k, v]) => updateTrait.run(Number(v), k));
    }

    // Increment exchanges
    const ex = parseInt(getMetaVal('exchanges', '0')) + 1;
    setMeta.run('exchanges', String(ex));

    res.json({ ok: true, state: loadState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET /api/weather ─────────────────────────────────────────────────────
app.get('/api/weather', async (req, res) => {
  const city = req.query.city || process.env.DEFAULT_CITY || 'Nairobi';
  const key  = process.env.WEATHER_API_KEY;

  if (!key || key === 'your_openweathermap_key_here') {
    return res.json({ error: 'No weather API key configured', mock: true,
      data: { city, temp: 22, description: 'partly cloudy', humidity: 65, wind: 4 } });
  }

  try {
    const r    = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`);
    const data = await r.json();
    res.json({
      city:        data.name,
      temp:        Math.round(data.main.temp),
      feels_like:  Math.round(data.main.feels_like),
      description: data.weather[0].description,
      humidity:    data.main.humidity,
      wind:        data.wind.speed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET /api/news ────────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  const q   = req.query.q || 'technology';

  if (!key || key === 'your_newsapi_key_here') {
    return res.json({ articles: [
      { title: 'Configure your NewsAPI key in .env to get live news', url: '#' },
    ]});
  }

  try {
    const r    = await fetch(`https://newsapi.org/v2/top-headlines?category=${q}&apiKey=${key}&pageSize=5&language=en`);
    const data = await r.json();
    res.json({ articles: (data.articles || []).slice(0,5).map(a => ({ title: a.title, url: a.url, source: a.source?.name })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET /api/search ──────────────────────────────────────────────────────
// Uses DuckDuckGo instant answer API (no key needed)
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ result: null });

  try {
    const r    = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`);
    const data = await r.json();
    const result = data.AbstractText || data.Answer || data.Definition || null;
    const url    = data.AbstractURL || null;
    res.json({ result, url, heading: data.Heading });
  } catch (err) {
    res.json({ result: null });
  }
});

// ── API: POST /api/open ───────────────────────────────────────────────────────
// Open websites and apps on the user's machine
app.post('/api/open', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: 'No target specified' });

  try {
    await open(target);
    res.json({ ok: true, opened: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET /api/time ────────────────────────────────────────────────────────
app.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({
    time:     now.toLocaleTimeString('en-GB'),
    date:     now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    iso:      now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

// ── API: GET /api/export ──────────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  res.json(loadState());
});

// ── API: POST /api/import ─────────────────────────────────────────────────────
app.post('/api/import', (req, res) => {
  const data = req.body;
  try {
    const insertMem = db.prepare(`INSERT OR IGNORE INTO memories (text) VALUES (?)`);
    const insertIns = db.prepare(`INSERT OR IGNORE INTO insights (text) VALUES (?)`);
    const updTrait  = db.prepare(`INSERT OR REPLACE INTO traits (key, value) VALUES (?, ?)`);

    if (Array.isArray(data.memories)) data.memories.forEach(m => insertMem.run(m));
    if (Array.isArray(data.insights)) data.insights.forEach(i => insertIns.run(i));
    if (data.traits) Object.entries(data.traits).forEach(([k,v]) => updTrait.run(k, v));
    if (data.identityPhrase) setMeta.run('identity_phrase', data.identityPhrase);

    res.json({ ok: true, state: loadState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║     J.A.R.V.I.S.  DIGITAL TWIN  ONLINE      ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  Open: http://localhost:${PORT}                 ║`);
  console.log(`║  Session: ${String(sessions).padEnd(35)}║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});
