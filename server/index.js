require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fetch    = require('node-fetch');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── STARTUP CHECKS ────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║     J.A.R.V.I.S.  DIGITAL TWIN  BOOTING     ║');
console.log('╚══════════════════════════════════════════════╝');

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
  console.log('\n❌  ERROR: ANTHROPIC_API_KEY not set in .env');
  console.log('   1. Copy .env.example → .env');
  console.log('   2. Add your key from https://console.anthropic.com');
  console.log('   3. Restart with: npm start\n');
} else {
  console.log('✓  Anthropic API key loaded');
}

// ── DATABASE (SQLite for unlimited memory) ────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(DATA_DIR, 'jarvis.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT UNIQUE, created TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS insights (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT UNIQUE, created TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS traits   (key TEXT PRIMARY KEY, value REAL DEFAULT 40);
    CREATE TABLE IF NOT EXISTS meta     (key TEXT PRIMARY KEY, value TEXT);
  `);
  ['openness','assertiveness','empathy','logic','creativity','resilience'].forEach(k =>
    db.prepare('INSERT OR IGNORE INTO traits (key, value) VALUES (?, 40)').run(k));
  const sessions = parseInt((db.prepare('SELECT value FROM meta WHERE key=?').get('sessions') || {value:'0'}).value) + 1;
  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('sessions', String(sessions));
  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('last_seen', new Date().toISOString());
  console.log('✓  SQLite database ready');
} catch(e) {
  console.log('⚠  SQLite not available, using in-memory storage:', e.message);
}

// In-memory fallback
const memStore = { memories:[], insights:[], traits:{openness:40,assertiveness:40,empathy:40,logic:40,creativity:40,resilience:40}, exchanges:0, sessions:1, identityPhrase:null };

function loadState() {
  if (!db) return { ...memStore, lastSeen: new Date().toISOString() };
  const getMeta = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value || null;
  return {
    memories:       db.prepare('SELECT text FROM memories ORDER BY id DESC LIMIT 60').all().map(r=>r.text),
    insights:       db.prepare('SELECT text FROM insights ORDER BY id DESC LIMIT 40').all().map(r=>r.text),
    traits:         Object.fromEntries(db.prepare('SELECT key,value FROM traits').all().map(r=>[r.key,r.value])),
    exchanges:      parseInt(getMeta('exchanges') || '0'),
    sessions:       parseInt(getMeta('sessions') || '1'),
    identityPhrase: getMeta('identity_phrase'),
    lastSeen:       getMeta('last_seen'),
    createdAt:      getMeta('created_at') || new Date().toISOString(),
  };
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => res.json(loadState()));

// Main chat proxy — keeps API key on server
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured in .env file. Please add it and restart the server.' } });
  }

  console.log(`[CHAT] Sending ${messages.length} messages to Claude...`);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1024, system:systemPrompt, messages }),
    });

    const data = await response.json();
    if (data.error) {
      console.error('[CHAT ERROR]', data.error);
      return res.status(400).json(data);
    }
    console.log('[CHAT] Response received, length:', data.content?.[0]?.text?.length);
    res.json(data);
  } catch (err) {
    console.error('[CHAT FETCH ERROR]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// Save twin memory
app.post('/api/memory', (req, res) => {
  const { memory, insight, identityPhrase, traitDeltas, mood } = req.body;
  if (!db) {
    if (memory) memStore.memories.unshift(memory);
    if (insight) memStore.insights.unshift(insight);
    if (identityPhrase) memStore.identityPhrase = identityPhrase;
    memStore.exchanges++;
    return res.json({ ok:true, state: { ...memStore, lastSeen: new Date().toISOString() } });
  }
  try {
    if (memory && memory !== 'null')         db.prepare('INSERT OR IGNORE INTO memories (text) VALUES (?)').run(memory);
    if (insight && insight !== 'null')       db.prepare('INSERT OR IGNORE INTO insights (text) VALUES (?)').run(insight);
    if (identityPhrase && identityPhrase !== 'null') db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('identity_phrase', identityPhrase);
    if (mood)  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('mood', mood);
    if (traitDeltas) {
      const upd = db.prepare('UPDATE traits SET value = MAX(5, MIN(95, value + ?)) WHERE key = ?');
      Object.entries(traitDeltas).forEach(([k,v]) => upd.run(Number(v), k));
    }
    const ex = parseInt((db.prepare('SELECT value FROM meta WHERE key=?').get('exchanges') || {value:'0'}).value) + 1;
    db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('exchanges', String(ex));
    res.json({ ok:true, state: loadState() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Weather
app.get('/api/weather', async (req, res) => {
  const city = req.query.city || process.env.DEFAULT_CITY || 'Nairobi';
  const key  = process.env.WEATHER_API_KEY;
  if (!key || key === 'your_openweathermap_key_here')
    return res.json({ city, temp:22, description:'partly cloudy', humidity:65, wind:4, mock:true });
  try {
    const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`);
    const d = await r.json();
    res.json({ city:d.name, temp:Math.round(d.main.temp), feels_like:Math.round(d.main.feels_like), description:d.weather[0].description, humidity:d.main.humidity, wind:d.wind.speed });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// News
app.get('/api/news', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key || key === 'your_newsapi_key_here')
    return res.json({ articles:[{ title:'Add NEWS_API_KEY to .env for live headlines', url:'#' }] });
  try {
    const r = await fetch(`https://newsapi.org/v2/top-headlines?category=general&apiKey=${key}&pageSize=5&language=en`);
    const d = await r.json();
    res.json({ articles:(d.articles||[]).slice(0,5).map(a=>({ title:a.title, url:a.url, source:a.source?.name })) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// DuckDuckGo search (no key needed)
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ result:null });
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`);
    const d = await r.json();
    res.json({ result: d.AbstractText||d.Answer||d.Definition||null, url:d.AbstractURL||null, heading:d.Heading });
  } catch { res.json({ result:null }); }
});

// Time
app.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({ time:now.toLocaleTimeString('en-GB'), date:now.toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'}), iso:now.toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone });
});

// Open app/website
app.post('/api/open', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error:'No target' });
  try {
    const { default: open } = await import('open');
    await open(target);
    res.json({ ok:true, opened:target });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// Export / import
app.get('/api/export', (req, res) => res.json(loadState()));
app.post('/api/import', (req, res) => {
  const data = req.body;
  if (!db) { Object.assign(memStore, data); return res.json({ ok:true, state:memStore }); }
  try {
    if (Array.isArray(data.memories)) data.memories.forEach(m => db.prepare('INSERT OR IGNORE INTO memories (text) VALUES (?)').run(m));
    if (Array.isArray(data.insights)) data.insights.forEach(i => db.prepare('INSERT OR IGNORE INTO insights (text) VALUES (?)').run(i));
    if (data.traits) Object.entries(data.traits).forEach(([k,v]) => db.prepare('INSERT OR REPLACE INTO traits (key,value) VALUES (?,?)').run(k,v));
    if (data.identityPhrase) db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run('identity_phrase',data.identityPhrase);
    res.json({ ok:true, state:loadState() });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓  JARVIS online → http://localhost:${PORT}`);
  console.log(`   Open in Chrome for full voice support\n`);
});
