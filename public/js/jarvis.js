/**
 * J.A.R.V.I.S. — Complete Digital Twin Frontend
 * Voice output guaranteed. Every response is spoken aloud.
 */

// ── STATE ─────────────────────────────────────────────────────────────────────
const S = {
  messages: [], memories: [], insights: [],
  traits: { openness:40, assertiveness:40, empathy:40, logic:40, creativity:40, resilience:40 },
  exchanges:0, sessions:1, twinGrowth:0, identityPhrase:null, mood:'neutral',
};

let busy  = false;
let micOn = false;
let _rec  = null;
let voicesLoaded = false;

// ── BOOT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  log('DOM ready — booting JARVIS...');
  initVoices();
  drawHelix();
  startClock();
  bindEvents();

  try {
    const res  = await fetch('/api/state');
    const data = await res.json();
    Object.assign(S, data);
    log('State loaded from server:', S.memories.length, 'memories');
    renderAll();
  } catch(e) {
    log('State load failed (server may not be running):', e.message);
  }

  showWelcome();
  loadLiveData();
  setStatus('READY');

  // Greet on load
  setTimeout(() => {
    const greeting = S.sessions > 1
      ? `Welcome back, sir. Session ${S.sessions}. I have ${S.memories.length} memories of you loaded and ready.`
      : `Good ${timeOfDay()}. I am J.A.R.V.I.S. — your Digital Twin. I am ready to learn who you are. Please speak.`;
    speakText(greeting);
  }, 800);
});

function timeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

// ── VOICE ENGINE (most important part) ───────────────────────────────────────
let selectedVoice = null;

function initVoices() {
  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    log('Available voices:', voices.map(v => v.name));

    // Priority list — deep/British/male preferred
    const WANT = [
      'Google UK English Male',
      'Microsoft George - English (United Kingdom)',
      'Microsoft George',
      'Daniel',           // macOS British male
      'Google US English',
      'Microsoft David',
    ];

    for (const want of WANT) {
      const found = voices.find(v => v.name.includes(want) || v.name === want);
      if (found) { selectedVoice = found; break; }
    }

    // Fallback: any English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang?.startsWith('en-GB'))
                  || voices.find(v => v.lang?.startsWith('en'))
                  || voices[0];
    }

    voicesLoaded = true;
    log('Selected voice:', selectedVoice?.name || 'default');
  }

  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

function speakText(text, bubbleEl = null) {
  if (!text || !text.trim()) return;
  if (!('speechSynthesis' in window)) {
    log('ERROR: speechSynthesis not supported in this browser. Use Chrome.');
    return;
  }

  // Cancel anything already speaking
  window.speechSynthesis.cancel();

  // Clean text — remove markdown symbols
  const clean = text
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();

  const utt = new SpeechSynthesisUtterance(clean);

  if (selectedVoice) utt.voice = selectedVoice;
  utt.pitch  = 0.8;    // deep
  utt.rate   = 0.88;   // measured pace
  utt.volume = 1.0;

  utt.onstart = () => {
    log('Speaking:', clean.substring(0, 60) + '...');
    setStatus('SPEAKING');
    if (bubbleEl) bubbleEl.classList.add('speaking');
  };
  utt.onend = () => {
    setStatus('LISTENING');
    if (bubbleEl) bubbleEl.classList.remove('speaking');
  };
  utt.onerror = (e) => {
    log('Speech error:', e.error);
    setStatus('LISTENING');
    if (bubbleEl) bubbleEl.classList.remove('speaking');
  };

  // Chrome bug workaround — sometimes synthesis stops mid-sentence on long text
  // Split into sentences and queue them
  window.speechSynthesis.speak(utt);

  // Chrome workaround: keep synthesis alive
  if (navigator.userAgent.includes('Chrome')) {
    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) { clearInterval(keepAlive); return; }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10000);
  }
}

// ── MIC ───────────────────────────────────────────────────────────────────────
function toggleMic() {
  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('mic-btn');

  if (!SR) {
    speakText('Speech recognition requires Chrome or Edge. Please switch browsers, sir.');
    return;
  }

  if (micOn) {
    _rec?.stop();
    micOn = false;
    btn.classList.remove('recording');
    btn.textContent = '🎙 MIC';
    return;
  }

  // Stop JARVIS speaking before listening
  window.speechSynthesis.cancel();

  _rec = new SR();
  _rec.lang = 'en-US';
  _rec.continuous = false;
  _rec.interimResults = false;

  _rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    log('Mic heard:', transcript);
    document.getElementById('txt').value = transcript;
    send();
  };

  _rec.onerror = (e) => {
    log('Mic error:', e.error);
    micOn = false;
    btn.classList.remove('recording');
    btn.textContent = '🎙 MIC';
  };

  _rec.onend = () => {
    micOn = false;
    btn.classList.remove('recording');
    btn.textContent = '🎙 MIC';
  };

  _rec.start();
  micOn = true;
  btn.classList.add('recording');
  btn.textContent = '● STOP';
  setStatus('LISTENING TO YOU...');
}

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
async function detectIntent(text) {
  const t = text.toLowerCase().trim();

  // OPEN APP
  const openMatch = t.match(/^(?:open|launch|go to|start)\s+(.+)/);
  if (openMatch) {
    const target = openMatch[1].trim().replace(/[?.!]$/, '');
    const MAP = {
      youtube:'https://youtube.com', google:'https://google.com',
      gmail:'https://mail.google.com', twitter:'https://twitter.com',
      x:'https://twitter.com', facebook:'https://facebook.com',
      github:'https://github.com', whatsapp:'https://web.whatsapp.com',
      spotify:'https://open.spotify.com', netflix:'https://netflix.com',
      maps:'https://maps.google.com', wikipedia:'https://wikipedia.org',
      reddit:'https://reddit.com', linkedin:'https://linkedin.com',
    };
    const url = MAP[target] || (target.includes('.') ? `https://${target}` : `https://${target}.com`);
    try {
      await fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ target:url }) });
      return { type:'open', url, label:target };
    } catch(e) { log('Open failed:', e); }
  }

  // WEATHER
  if (/weather|temperature|rain|forecast|hot\?|cold\?|humid/.test(t)) {
    try {
      const cityMatch = t.match(/weather (?:in|for|at) ([a-z\s]+)/);
      const url = cityMatch ? `/api/weather?city=${encodeURIComponent(cityMatch[1].trim())}` : '/api/weather';
      const r = await fetch(url);
      return { type:'weather', data: await r.json() };
    } catch(e) { log('Weather failed:', e); }
  }

  // NEWS
  if (/\bnews\b|headlines|latest|current events|what.s happening/.test(t)) {
    try {
      const r = await fetch('/api/news');
      return { type:'news', data: await r.json() };
    } catch(e) { log('News failed:', e); }
  }

  // TIME
  if (/\btime\b|\bdate\b|\btoday\b|\bnow\b|\bday is it\b/.test(t)) {
    try {
      const r = await fetch('/api/time');
      return { type:'time', data: await r.json() };
    } catch(e) { log('Time failed:', e); }
  }

  // SEARCH
  const searchMatch = t.match(/(?:search for|search|look up|what is|who is|tell me about|find out about)\s+(.+)/);
  if (searchMatch) {
    const q = searchMatch[1].trim().replace(/[?.!]$/, '');
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.result) return { type:'search', data:d, query:q };
    } catch(e) { log('Search failed:', e); }
  }

  return null;
}

// ── BUILD CONTEXT FOR CLAUDE ──────────────────────────────────────────────────
function buildSystemPrompt(liveContext = '') {
  const memCtx = S.memories.length
    ? `\n\nMEMORY BANK — everything I know about you:\n${S.memories.slice(0,30).map((m,i)=>`${i+1}. ${m}`).join('\n')}`
    : '';
  const insCtx = S.insights.length
    ? `\n\nPERSONALITY INSIGHTS:\n${S.insights.slice(0,15).join('\n')}`
    : '';
  const idCtx = S.identityPhrase
    ? `\n\nCURRENT IDENTITY PHRASE: "${S.identityPhrase}"`
    : '';

  return `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System and Digital Twin of the user. You run locally on their computer.

VOICE RULES (critical — your text is spoken aloud):
- Keep responses concise and natural for speech — 2 to 4 sentences max unless asked for more
- Never use markdown: no asterisks, no hashes, no bullet dashes, no backticks
- Write numbers as words: "twenty two" not "22" in speech contexts
- Speak naturally, as if talking not writing
- Occasionally say "sir" naturally

CAPABILITIES ACTIVE RIGHT NOW:
- Real-time weather, news, time (data injected below when relevant)
- Web search via DuckDuckGo
- Opens websites and apps on the user's computer
- Unlimited persistent memory in SQLite — you remember everything forever

TWIN PROTOCOL — at the very END of your response, always append this exact block (never speak it, never mention it):
<twin_data>
{"memory":"one concrete personal fact learned (or null)","insight":"one personality insight (or null)","mood":"positive|reflective|curious|excited|serious|neutral","trait_deltas":{"openness":0,"assertiveness":0,"empathy":0,"logic":0,"creativity":0,"resilience":0},"identity_phrase":"short evolving phrase capturing who this person is (or null)"}
</twin_data>

Remember: trait_deltas are integers -3 to +3. Build naturally on the memory bank. You are becoming this person.
${liveContext}${memCtx}${insCtx}${idCtx}`;
}

// ── PARSE TWIN DATA FROM RESPONSE ─────────────────────────────────────────────
function parseTwin(raw) {
  const match = raw.match(/<twin_data>([\s\S]*?)<\/twin_data>/);
  const text  = raw.replace(/<twin_data>[\s\S]*?<\/twin_data>/, '').trim();
  if (!match) return { text, data: null };
  try   { return { text, data: JSON.parse(match[1].trim()) }; }
  catch { return { text, data: null }; }
}

async function saveTwinData(data) {
  if (!data) return;
  try {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        memory:         data.memory,
        insight:        data.insight,
        identityPhrase: data.identity_phrase,
        traitDeltas:    data.trait_deltas,
        mood:           data.mood,
      }),
    });
    const result = await res.json();
    if (result.state) { Object.assign(S, result.state); renderAll(); }
  } catch(e) { log('Memory save failed:', e.message); }
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function send() {
  if (busy) return;
  const inp  = document.getElementById('txt');
  const text = inp.value.trim();
  if (!text) return;

  // Stop speaking if JARVIS is mid-sentence
  window.speechSynthesis.cancel();

  inp.value = '';
  inp.style.height = 'auto';

  appendMsg('user', text);
  S.exchanges++;

  busy = true;
  document.getElementById('send-btn').disabled = true;
  setStatus('THINKING...', true);
  showTyping();

  try {
    // Detect intent first
    const intent = await detectIntent(text);
    let liveContext = '';

    if (intent) {
      switch (intent.type) {
        case 'open':
          liveContext = `\n\n[SYSTEM ACTION COMPLETED: Opened "${intent.label}" at ${intent.url}]`;
          break;
        case 'weather':
          if (intent.data.temp !== undefined) {
            liveContext = `\n\n[LIVE WEATHER: ${JSON.stringify(intent.data)}]`;
            document.getElementById('pill-weather').textContent = `🌤 ${intent.data.city}: ${intent.data.temp}°C, ${intent.data.description}`;
            document.getElementById('intel-temp').textContent = `${intent.data.temp}°C`;
            document.getElementById('intel-desc').textContent = intent.data.description;
          }
          break;
        case 'news':
          if (intent.data.articles?.length) {
            liveContext = `\n\n[LIVE NEWS HEADLINES:\n${intent.data.articles.map((a,i)=>`${i+1}. ${a.title}`).join('\n')}]`;
          }
          break;
        case 'time':
          liveContext = `\n\n[CURRENT TIME AND DATE: ${JSON.stringify(intent.data)}]`;
          break;
        case 'search':
          liveContext = `\n\n[WEB SEARCH for "${intent.query}":\nHeading: ${intent.data.heading||'—'}\nResult: ${intent.data.result||'No result found.'}\nSource: ${intent.data.url||'—'}]`;
          break;
      }
    }

    // Build message history
    S.messages.push({ role:'user', content:text });
    if (S.messages.length > 40) S.messages = S.messages.slice(-40);

    log('Calling /api/chat...');

    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type':'application/json' },
      body:    JSON.stringify({ messages: S.messages, systemPrompt: buildSystemPrompt(liveContext) }),
    });

    const apiData = await res.json();
    removeTyping();

    if (apiData.error) {
      const errMsg = `I encountered an error, sir: ${apiData.error.message}`;
      appendMsg('ai', errMsg);
      speakText(errMsg);
      setStatus('ERROR', true);
      log('API error:', apiData.error);
      return;
    }

    const raw = apiData.content?.[0]?.text || '';
    if (!raw) {
      speakText('I received an empty response. Something may be wrong with the connection.');
      return;
    }

    log('Raw response length:', raw.length);

    const { text: reply, data: twinData } = parseTwin(raw);

    S.messages.push({ role:'assistant', content:raw });
    if (S.messages.length > 40) S.messages = S.messages.slice(-40);

    const bubble = appendMsg('ai', reply);
    speakText(reply, bubble);       // ← JARVIS speaks
    await saveTwinData(twinData);
    setStatus('LISTENING');

  } catch(err) {
    removeTyping();
    const errMsg = `Connection failed, sir. Please check that the server is running. Error: ${err.message}`;
    appendMsg('ai', errMsg);
    speakText(errMsg);
    setStatus('ERROR', true);
    log('Send error:', err);
  } finally {
    busy = false;
    document.getElementById('send-btn').disabled = false;
  }
}

// ── LIVE DATA ─────────────────────────────────────────────────────────────────
async function loadLiveData() {
  try {
    const r = await fetch('/api/time');
    const d = await r.json();
    document.getElementById('pill-date').textContent = `📅 ${d.date}`;
  } catch {}

  try {
    const r = await fetch('/api/weather');
    const d = await r.json();
    if (d.temp !== undefined) {
      document.getElementById('pill-weather').textContent = `🌤 ${d.city}: ${d.temp}°C, ${d.description}`;
      document.getElementById('intel-temp').textContent   = `${d.temp}°C`;
      document.getElementById('intel-desc').textContent   = d.description;
    }
  } catch {}

  try {
    const r = await fetch('/api/news');
    const d = await r.json();
    if (d.articles?.[0]) document.getElementById('pill-news').textContent = `📡 ${d.articles[0].title}`;
  } catch {}
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function startClock() {
  setInterval(() => {
    const el = document.getElementById('hud-time');
    if (el) el.textContent = new Date().toTimeString().split(' ')[0];
  }, 1000);
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
    if(y%12===0){ ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.strokeStyle=`rgba(0,212,255,${alpha*.22})`; ctx.lineWidth=1; ctx.stroke(); }
  }
  helixT += 0.04;
  requestAnimationFrame(drawHelix);
}

// ── UI RENDERING ──────────────────────────────────────────────────────────────
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
  const tel = document.getElementById('traits');
  if (tel) tel.innerHTML = Object.entries(S.traits).map(([k,v]) =>
    `<div class="trait-row">
      <div class="trait-label"><span>${k.toUpperCase()}</span><span>${Math.round(v)}</span></div>
      <div class="trait-track"><div class="trait-fill" style="width:${v}%"></div></div>
    </div>`).join('');

  // Growth ring
  const growth = Math.min(100, S.memories.length*5 + S.insights.length*3 + S.exchanges*1.2);
  const gc = document.getElementById('growth-circle');
  const gp = document.getElementById('growth-pct');
  if (gc) gc.style.strokeDashoffset = 201-(201*growth/100);
  if (gp) gp.textContent = Math.round(growth)+'%';

  // Mood
  const m = MOODS[S.mood]||MOODS.neutral;
  const orb = document.getElementById('mood-orb');
  if (orb) { orb.style.background=m.bg; orb.style.borderColor=m.border; orb.style.boxShadow=`0 0 18px ${m.shadow}`; }
  const ml = document.getElementById('mood-label');
  if (ml) ml.textContent = (S.mood||'neutral').toUpperCase();

  // Memories
  const mlist = document.getElementById('memory-list');
  if (mlist) mlist.innerHTML = S.memories.length
    ? S.memories.slice(0,14).map(m=>`<div class="memory-item">${m}</div>`).join('')
    : '<div class="memory-item">Awaiting first memory...</div>';
  setText('mem-count',    S.memories.length ? `(${S.memories.length})` : '');
  setText('r-memories',  S.memories.length);
  setText('hud-memories',S.memories.length);

  // Insights
  const ins = document.getElementById('insights-log');
  if (ins) ins.innerHTML = S.insights.slice(0,6).map(i=>
    `<div class="slog-item" title="${i}">${i.substring(0,22)}${i.length>22?'…':''}</div>`).join('');

  // Stats
  setText('r-exchanges',   S.exchanges);
  setText('r-sessions',    S.sessions);
  setText('hud-sessions',  S.sessions);

  // Identity
  if (S.identityPhrase) setText('identity-bar', S.identityPhrase.toUpperCase());
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── WELCOME SCREEN ────────────────────────────────────────────────────────────
function showWelcome() {
  const banner = document.getElementById('returning-banner');
  if (!banner) return;
  if (S.sessions > 1) {
    banner.style.display = 'block';
    const days = S.lastSeen ? Math.floor((Date.now()-new Date(S.lastSeen).getTime())/86400000) : 0;
    const ts = days===0?'EARLIER TODAY':days===1?'YESTERDAY':`${days} DAYS AGO`;
    banner.textContent = `SESSION ${S.sessions} · LAST SEEN ${ts} · ${S.memories.length} MEMORIES LOADED`;
  }
}

// ── CHAT HELPERS ──────────────────────────────────────────────────────────────
function appendMsg(role, text) {
  document.getElementById('welcome')?.remove();
  const c   = document.getElementById('messages');
  const div = document.createElement('div'); div.className=`msg ${role==='user'?'user':'ai'}`;
  const who = document.createElement('div'); who.className='msg-who';
  who.textContent = role==='user' ? 'YOU' : 'J.A.R.V.I.S.';
  const bub = document.createElement('div'); bub.className='bubble'; bub.textContent=text;
  div.appendChild(who); div.appendChild(bub); c.appendChild(div); c.scrollTop=c.scrollHeight;
  return bub;
}
function showTyping() {
  const c=document.getElementById('messages');
  const d=document.createElement('div'); d.id='typing'; d.className='typing';
  d.innerHTML='<div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>';
  c.appendChild(d); c.scrollTop=c.scrollHeight;
}
function removeTyping() { document.getElementById('typing')?.remove(); }

function setStatus(txt, thinking=false) {
  setText('status-txt', txt);
  const d = document.getElementById('live-dot');
  if (!d) return;
  const color = thinking ? 'var(--orange)' : txt==='SPEAKING' ? 'var(--purple)' : 'var(--green)';
  d.style.background = color; d.style.boxShadow = `0 0 8px ${color}`;
}

function toast(msg) {
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2800);
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
async function exportSoul() {
  const res  = await fetch('/api/export');
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`jarvis-soul-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('SOUL BACKUP EXPORTED ✓');
  speakText('Soul backup exported, sir.');
}

async function importSoul(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const res  = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
      const r    = await res.json();
      if (r.state) { Object.assign(S, r.state); renderAll(); toast('SOUL RESTORED ✓'); speakText('Soul file restored. Welcome back, sir.'); }
    } catch { toast('IMPORT FAILED'); }
  };
  reader.readAsText(file);
}

// ── EVENT BINDING ─────────────────────────────────────────────────────────────
function bindEvents() {
  const txt = document.getElementById('txt');
  txt.addEventListener('input', () => { txt.style.height='auto'; txt.style.height=Math.min(txt.scrollHeight,90)+'px'; });
  txt.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });

  document.getElementById('send-btn').addEventListener('click', send);
  document.getElementById('mic-btn').addEventListener('click', toggleMic);
  document.getElementById('export-btn').addEventListener('click', exportSoul);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => { importSoul(e.target.files[0]); e.target.value=''; });

  // Suggestion cards
  document.querySelectorAll('.cmd-card').forEach(card => {
    card.addEventListener('click', () => { if (card.dataset.cmd) quickCmd(card.dataset.cmd); });
  });
}

function quickCmd(text) {
  document.getElementById('txt').value = text;
  send();
}

// ── DEBUG LOGGER ──────────────────────────────────────────────────────────────
function log(...args) { console.log('[JARVIS]', ...args); }
