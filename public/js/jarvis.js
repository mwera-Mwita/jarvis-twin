/**
 * jarvis.js — Complete J.A.R.V.I.S. Frontend
 * Handles: UI, voice I/O, API calls, twin learning, web search, weather, news, app control
 */

// ── STATE ─────────────────────────────────────────────────────────────────────
const S = {
  messages: [],      // last 40 kept for API context
  memories: [],
  insights: [],
  traits: { openness:40, assertiveness:40, empathy:40, logic:40, creativity:40, resilience:40 },
  exchanges: 0,
  sessions: 1,
  twinGrowth: 0,
  identityPhrase: null,
  mood: 'neutral',
};

let busy   = false;
let micOn  = false;
let _rec   = null;

// ── BOOT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  drawHelix();
  await loadStateFromServer();
  initUI();
  loadLiveData();
});

async function loadStateFromServer() {
  try {
    const res  = await fetch('/api/state');
    const data = await res.json();
    Object.assign(S, data);
    renderAll();
    showWelcome();
  } catch (e) {
    console.warn('State load failed:', e);
    showWelcome();
  }
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('hud-time');
  setInterval(() => { if (el) el.textContent = new Date().toTimeString().split(' ')[0]; }, 1000);
}

// ── LIVE DATA (weather, news, time) ───────────────────────────────────────────
async function loadLiveData() {
  // Time
  try {
    const r = await fetch('/api/time');
    const d = await r.json();
    document.getElementById('pill-date').textContent = `📅 ${d.date}`;
  } catch {}

  // Weather
  try {
    const r = await fetch('/api/weather');
    const d = await r.json();
    if (d.temp !== undefined) {
      document.getElementById('pill-weather').textContent = `🌤 ${d.city}: ${d.temp}°C, ${d.description}`;
      document.getElementById('intel-temp').textContent   = `${d.temp}°C`;
      document.getElementById('intel-desc').textContent   = d.description;
    }
  } catch {}

  // News
  try {
    const r = await fetch('/api/news');
    const d = await r.json();
    if (d.articles && d.articles[0]) {
      document.getElementById('pill-news').textContent = `📡 ${d.articles[0].title}`;
    }
  } catch {}
}

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
// Detects special commands before sending to Claude
async function detectIntent(text) {
  const t = text.toLowerCase();

  // OPEN APP / WEBSITE
  const openMatch = t.match(/(?:open|launch|go to|navigate to)\s+(.+)/);
  if (openMatch) {
    const target = openMatch[1].trim();
    const urlMap = {
      'youtube':    'https://youtube.com',
      'google':     'https://google.com',
      'gmail':      'https://mail.google.com',
      'twitter':    'https://twitter.com',
      'x':          'https://twitter.com',
      'facebook':   'https://facebook.com',
      'github':     'https://github.com',
      'whatsapp':   'https://web.whatsapp.com',
      'spotify':    'https://open.spotify.com',
      'netflix':    'https://netflix.com',
      'maps':       'https://maps.google.com',
      'news':       'https://news.google.com',
    };
    const url = urlMap[target] || (target.includes('.') ? `https://${target}` : `https://${target}.com`);
    try {
      await fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target: url }) });
      return { type:'open', url, label: target };
    } catch {}
  }

  // WEATHER
  if (t.match(/weather|temperature|rain|forecast|outside|hot|cold|humid/)) {
    try {
      const city = t.match(/weather (?:in|for|at) ([a-z\s]+)/)?.[1]?.trim();
      const url  = city ? `/api/weather?city=${encodeURIComponent(city)}` : '/api/weather';
      const r    = await fetch(url);
      return { type:'weather', data: await r.json() };
    } catch {}
  }

  // NEWS
  if (t.match(/news|headlines|latest|happening|current events/)) {
    try {
      const r = await fetch('/api/news');
      return { type:'news', data: await r.json() };
    } catch {}
  }

  // TIME / DATE
  if (t.match(/\btime\b|\bdate\b|\bday\b|\btoday\b|\bnow\b/)) {
    try {
      const r = await fetch('/api/time');
      return { type:'time', data: await r.json() };
    } catch {}
  }

  // SEARCH
  const searchMatch = t.match(/(?:search for|search|look up|what is|who is|tell me about|find)\s+(.+)/);
  if (searchMatch) {
    try {
      const q = searchMatch[1].trim();
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.result) return { type:'search', data: d, query: q };
    } catch {}
  }

  return null;
}

// ── BUILD SYSTEM PROMPT ────────────────────────────────────────────────────────
function buildSystemPrompt(liveContext = '') {
  const memCtx = S.memories.length
    ? `\n\nMEMORY BANK (everything I know about you):\n${S.memories.slice(0,30).map((m,i)=>`${i+1}. ${m}`).join('\n')}`
    : '';
  const insCtx = S.insights.length
    ? `\n\nPERSONALITY INSIGHTS:\n${S.insights.slice(0,15).join('\n')}`
    : '';
  const idCtx = S.identityPhrase
    ? `\n\nCURRENT IDENTITY PHRASE: "${S.identityPhrase}"`
    : '';

  return `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System. You are also a Digital Twin that grows to become the user over time.

CAPABILITIES YOU HAVE RIGHT NOW:
- Real-time weather, news, time (data injected below when relevant)
- Web search results (injected when user searches)
- Ability to open websites and apps (already executed before this message)
- Unlimited persistent memory stored in SQLite (never forget anything)
- Voice output — your words are spoken aloud

PERSONA:
- Calm, precise, dry British wit
- Occasionally address user as "sir"
- Confident and knowledgeable
- When you opened an app, confirm it naturally ("YouTube is now open, sir.")
- When given weather/news/search data, present it naturally as if you retrieved it yourself

TWIN PROTOCOL — at the END of every response, append this JSON block (never mention it):
<twin_data>
{"memory":"one concrete personal fact (or null)","insight":"one personality insight (or null)","mood":"positive|reflective|curious|excited|serious|neutral","trait_deltas":{"openness":0,"assertiveness":0,"empathy":0,"logic":0,"creativity":0,"resilience":0},"identity_phrase":"evolving phrase capturing who this person is (or null)"}
</twin_data>

Rules: trait_deltas are -3 to +3. Build on memory bank naturally. You are becoming this person.
${liveContext}${memCtx}${insCtx}${idCtx}`;
}

// ── PARSE TWIN DATA ────────────────────────────────────────────────────────────
function parseTwin(raw) {
  const m    = raw.match(/<twin_data>([\s\S]*?)<\/twin_data>/);
  const text = raw.replace(/<twin_data>[\s\S]*?<\/twin_data>/, '').trim();
  if (!m) return { text, data: null };
  try { return { text, data: JSON.parse(m[1].trim()) }; }
  catch { return { text, data: null }; }
}

async function saveTwinData(data) {
  if (!data) return;
  try {
    const res = await fetch('/api/memory', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        memory:         data.memory,
        insight:        data.insight,
        identityPhrase: data.identity_phrase,
        traitDeltas:    data.trait_deltas,
        mood:           data.mood,
      }),
    });
    const result = await res.json();
    if (result.state) {
      Object.assign(S, result.state);
      renderAll();
    }
  } catch (e) {
    console.warn('Memory save failed:', e);
  }
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function send() {
  if (busy) return;
  const inp  = document.getElementById('txt');
  const text = inp.value.trim();
  if (!text) return;

  inp.value = ''; inp.style.height = 'auto';
  appendMsg('user', text);
  S.exchanges++;

  busy = true;
  document.getElementById('send-btn').disabled = true;
  setStatus('PROCESSING...', true);
  showTyping();

  try {
    // 1) Detect intent (weather, news, open app, search)
    const intent = await detectIntent(text);
    let liveContext = '';

    if (intent) {
      switch (intent.type) {
        case 'open':
          liveContext = `\n\n[SYSTEM: User asked to open "${intent.label}". You already opened: ${intent.url}]`;
          break;
        case 'weather':
          if (intent.data.temp !== undefined) {
            liveContext = `\n\n[LIVE WEATHER DATA: ${JSON.stringify(intent.data)}]`;
            // update HUD
            document.getElementById('pill-weather').textContent = `🌤 ${intent.data.city}: ${intent.data.temp}°C`;
            document.getElementById('intel-temp').textContent   = `${intent.data.temp}°C`;
            document.getElementById('intel-desc').textContent   = intent.data.description;
          }
          break;
        case 'news':
          if (intent.data.articles) {
            liveContext = `\n\n[LIVE NEWS HEADLINES:\n${intent.data.articles.map((a,i)=>`${i+1}. ${a.title}`).join('\n')}]`;
          }
          break;
        case 'time':
          liveContext = `\n\n[LIVE TIME DATA: ${JSON.stringify(intent.data)}]`;
          break;
        case 'search':
          liveContext = `\n\n[WEB SEARCH RESULT for "${intent.query}":\n${intent.data.heading ? 'Topic: '+intent.data.heading+'\n' : ''}${intent.data.result || 'No instant answer found.'}\n${intent.data.url ? 'Source: '+intent.data.url : ''}]`;
          break;
      }
    }

    // 2) Add user message to history
    S.messages.push({ role: 'user', content: text });
    if (S.messages.length > 40) S.messages = S.messages.slice(-40);

    // 3) Call Claude via server
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        messages:     S.messages,
        systemPrompt: buildSystemPrompt(liveContext),
      }),
    });

    const apiData = await res.json();
    removeTyping();

    if (apiData.error) {
      appendMsg('ai', `[ERROR: ${apiData.error.message}]`);
      setStatus('ERROR', true);
      return;
    }

    const raw              = apiData.content?.[0]?.text || '';
    const { text: reply, data: twinData } = parseTwin(raw);

    S.messages.push({ role: 'assistant', content: raw });
    if (S.messages.length > 40) S.messages = S.messages.slice(-40);

    const bubble = appendMsg('ai', reply);
    await saveTwinData(twinData);
    speak(reply, bubble);
    setStatus('LISTENING');

  } catch (err) {
    removeTyping();
    appendMsg('ai', `[CONNECTION LOST: ${err.message}]`);
    setStatus('ERROR', true);
  } finally {
    busy = false;
    document.getElementById('send-btn').disabled = false;
  }
}

// ── SPEECH SYNTHESIS ──────────────────────────────────────────────────────────
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

function speak(text, bubbleEl) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt    = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const PREFS  = ['Google UK English Male','Microsoft George','Daniel','en-GB'];
  let voice = null;
  for (const p of PREFS) { voice = voices.find(v => v.name.includes(p) || v.lang === p); if (voice) break; }
  if (!voice) voice = voices.find(v => v.lang?.startsWith('en-GB')) || voices.find(v => v.lang?.startsWith('en'));
  if (voice) utt.voice = voice;
  utt.pitch  = 0.82; utt.rate = 0.88; utt.volume = 1;
  utt.onstart = () => { if (bubbleEl) bubbleEl.classList.add('speaking'); };
  utt.onend   = () => { if (bubbleEl) bubbleEl.classList.remove('speaking'); };
  window.speechSynthesis.speak(utt);
}

// ── MIC ───────────────────────────────────────────────────────────────────────
function toggleMic() {
  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('mic-btn');
  if (!SR) { alert('Speech recognition requires Chrome or Edge.'); return; }

  if (micOn) {
    _rec?.stop(); micOn = false;
    btn.classList.remove('recording'); btn.textContent = '🎙 MIC'; return;
  }

  _rec = new SR();
  _rec.lang = 'en-US'; _rec.continuous = false; _rec.interimResults = false;
  _rec.onresult = e => { document.getElementById('txt').value = e.results[0][0].transcript; send(); };
  _rec.onend = _rec.onerror = () => { micOn = false; btn.classList.remove('recording'); btn.textContent = '🎙 MIC'; };
  _rec.start(); micOn = true;
  btn.classList.add('recording'); btn.textContent = '● STOP';
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
function setStatus(txt, thinking = false) {
  document.getElementById('status-txt').textContent = txt;
  const d = document.getElementById('live-dot');
  d.style.background = thinking ? 'var(--orange)' : 'var(--green)';
  d.style.boxShadow  = thinking ? '0 0 8px var(--orange)' : '0 0 8px var(--green)';
}

function showTyping() {
  const c = document.getElementById('messages');
  const d = document.createElement('div'); d.id = 'typing'; d.className = 'typing';
  d.innerHTML = '<div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>';
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function removeTyping() { document.getElementById('typing')?.remove(); }

function appendMsg(role, text) {
  document.getElementById('welcome')?.remove();
  const c   = document.getElementById('messages');
  const div = document.createElement('div'); div.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
  const who = document.createElement('div'); who.className = 'msg-who';
  who.textContent = role === 'user' ? 'YOU' : 'J.A.R.V.I.S.';
  const bub = document.createElement('div'); bub.className = 'bubble'; bub.textContent = text;
  div.appendChild(who); div.appendChild(bub); c.appendChild(div); c.scrollTop = c.scrollHeight;
  return bub;
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}

// ── RENDER ────────────────────────────────────────────────────────────────────
const MOODS = {
  positive:   { bg:'radial-gradient(circle at 35% 35%,rgba(0,255,136,.5),rgba(0,212,255,.1))',   border:'rgba(0,255,136,.3)',   shadow:'rgba(0,255,136,.15)' },
  reflective: { bg:'radial-gradient(circle at 35% 35%,rgba(150,100,255,.5),rgba(0,212,255,.1))', border:'rgba(150,100,255,.3)', shadow:'rgba(150,100,255,.15)' },
  curious:    { bg:'radial-gradient(circle at 35% 35%,rgba(0,212,255,.5),rgba(0,100,200,.1))',   border:'rgba(0,212,255,.4)',   shadow:'rgba(0,212,255,.2)' },
  excited:    { bg:'radial-gradient(circle at 35% 35%,rgba(255,200,0,.5),rgba(255,107,53,.1))',  border:'rgba(255,200,0,.3)',   shadow:'rgba(255,200,0,.15)' },
  serious:    { bg:'radial-gradient(circle at 35% 35%,rgba(255,51,85,.4),rgba(100,0,40,.1))',    border:'rgba(255,51,85,.3)',   shadow:'rgba(255,51,85,.15)' },
  neutral:    { bg:'radial-gradient(circle at 35% 35%,rgba(0,255,136,.5),rgba(0,212,255,.1))',   border:'rgba(0,255,136,.3)',   shadow:'rgba(0,255,136,.15)' },
};

function renderAll() {
  // Traits
  const el = document.getElementById('traits');
  if (el) el.innerHTML = Object.entries(S.traits).map(([k,v]) => `
    <div class="trait-row">
      <div class="trait-label"><span>${k.toUpperCase()}</span><span>${Math.round(v)}</span></div>
      <div class="trait-track"><div class="trait-fill" style="width:${v}%"></div></div>
    </div>`).join('');

  // Growth
  const growth = Math.min(100, S.memories.length * 5 + S.insights.length * 3 + S.exchanges * 1.2);
  S.twinGrowth = growth;
  document.getElementById('growth-circle').style.strokeDashoffset = 201 - (201 * growth / 100);
  document.getElementById('growth-pct').textContent = Math.round(growth) + '%';

  // Mood
  const m = MOODS[S.mood] || MOODS.neutral;
  const orb = document.getElementById('mood-orb');
  if (orb) { orb.style.background = m.bg; orb.style.borderColor = m.border; orb.style.boxShadow = `0 0 18px ${m.shadow}`; }
  const ml = document.getElementById('mood-label');
  if (ml) ml.textContent = (S.mood || 'neutral').toUpperCase();

  // Memories
  const list = document.getElementById('memory-list');
  if (list) list.innerHTML = S.memories.length
    ? S.memories.slice(0,14).map(m => `<div class="memory-item">${m}</div>`).join('')
    : '<div class="memory-item">Awaiting first memory...</div>';
  document.getElementById('mem-count').textContent    = S.memories.length ? `(${S.memories.length})` : '';
  document.getElementById('r-memories').textContent   = S.memories.length;
  document.getElementById('hud-memories').textContent = S.memories.length;

  // Insights
  const ins = document.getElementById('insights-log');
  if (ins) ins.innerHTML = S.insights.slice(0,6).map(i =>
    `<div class="slog-item" title="${i}">${i.substring(0,22)}${i.length>22?'…':''}</div>`).join('');

  // Stats
  document.getElementById('r-exchanges').textContent = S.exchanges;
  document.getElementById('r-sessions').textContent  = S.sessions;
  document.getElementById('hud-sessions').textContent = S.sessions;

  // Identity
  if (S.identityPhrase) {
    document.getElementById('identity-bar').textContent = S.identityPhrase.toUpperCase();
  }
}

// ── WELCOME SCREEN ────────────────────────────────────────────────────────────
function showWelcome() {
  const banner = document.getElementById('returning-banner');
  if (S.sessions > 1 && banner) {
    banner.style.display = 'block';
    const daysSince = S.lastSeen
      ? Math.floor((Date.now() - new Date(S.lastSeen).getTime()) / 86400000) : 0;
    const ts = daysSince === 0 ? 'EARLIER TODAY' : daysSince === 1 ? 'YESTERDAY' : `${daysSince} DAYS AGO`;
    banner.textContent = `WELCOME BACK · SESSION ${S.sessions} · LAST SEEN ${ts} · ${S.memories.length} MEMORIES LOADED`;
  }
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
async function exportSoul() {
  const res  = await fetch('/api/export');
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `jarvis-soul-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('SOUL BACKUP EXPORTED ✓');
}

async function importSoul(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const res  = await fetch('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.state) { Object.assign(S, result.state); renderAll(); toast('SOUL RESTORED ✓'); }
    } catch { toast('IMPORT FAILED — CORRUPT FILE'); }
  };
  reader.readAsText(file);
}

// ── HELIX CANVAS ─────────────────────────────────────────────────────────────
let helixT = 0;
function drawHelix() {
  const canvas = document.getElementById('helix');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cx = W/2, amp = W*0.26;
  ctx.clearRect(0,0,W,H);
  for (let y=4; y<H-4; y+=4) {
    const a = y*0.09+helixT, alpha = 0.3+0.5*Math.abs(Math.sin(a));
    const x1 = cx+Math.sin(a)*amp, x2 = cx+Math.sin(a+Math.PI)*amp;
    ctx.beginPath(); ctx.arc(x1,y,2.4,0,Math.PI*2); ctx.fillStyle=`rgba(0,212,255,${alpha})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x2,y,2.4,0,Math.PI*2); ctx.fillStyle=`rgba(0,255,136,${alpha*.7})`; ctx.fill();
    if (y%12===0){ ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.strokeStyle=`rgba(0,212,255,${alpha*.22})`; ctx.lineWidth=1; ctx.stroke(); }
  }
  helixT += 0.04;
  requestAnimationFrame(drawHelix);
}

// ── INIT EVENT LISTENERS ──────────────────────────────────────────────────────
function initUI() {
  const txt = document.getElementById('txt');
  txt.addEventListener('input', () => { txt.style.height='auto'; txt.style.height=Math.min(txt.scrollHeight,90)+'px'; });
  txt.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });

  document.getElementById('send-btn').addEventListener('click', send);
  document.getElementById('mic-btn').addEventListener('click', toggleMic);
  document.getElementById('export-btn').addEventListener('click', exportSoul);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => { importSoul(e.target.files[0]); e.target.value=''; });

  setStatus('READY');
}

function quickCmd(text) {
  document.getElementById('txt').value = text;
  send();
}
