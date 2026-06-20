# J.A.R.V.I.S. — Complete Digital Twin
> *Voice AI · Web Search · Weather · News · App Control · Unlimited Memory*

---

## Quick Start (5 minutes)

### 1. Clone & install
```bash
git clone https://github.com/mwera-Mwita/jarvis-twin.git
cd jarvis-twin
npm install
```

### 2. Configure your keys
```bash
cp .env.example .env
```
Open `.env` and fill in:

| Key | Where to get it | Required? |
|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | **YES** |
| `WEATHER_API_KEY` | [openweathermap.org/api](https://openweathermap.org/api) (free) | Optional |
| `NEWS_API_KEY` | [newsapi.org](https://newsapi.org) (free) | Optional |
| `DEFAULT_CITY` | Your city name e.g. `Nairobi` | Optional |

### 3. Run JARVIS
```bash
npm start
```

### 4. Open in Chrome
```
http://localhost:3000
```

> **Use Chrome or Edge** — required for voice input (mic) and best voice output.

---

## What JARVIS can do

| Command | Example |
|---|---|
| **Talk & learn** | "Tell me who you are and what drives you" |
| **Weather** | "What's the weather?" / "Weather in London" |
| **News** | "What are the latest headlines?" |
| **Time & date** | "What time is it?" / "What day is today?" |
| **Open apps/sites** | "Open YouTube" / "Open Gmail" / "Open Spotify" |
| **Web search** | "Search for artificial intelligence news" / "What is quantum computing?" |
| **Build your twin** | Any personal conversation — it learns and remembers everything |

---

## How it remembers (no cloud needed)

| Layer | Technology | Capacity |
|---|---|---|
| Conversation memory | SQLite database (local file) | **Unlimited** |
| Personality traits | SQLite | Persists forever |
| Soul backup | JSON export/import | Portable across devices |

Your data lives in `data/jarvis.db` — a local SQLite file on your computer. Nothing goes to any cloud. Only the AI responses go through the Anthropic API.

---

## Project structure

```
jarvis-twin/
├── server/
│   └── index.js          # Node.js + Express server
│                         #   - Proxies Claude API (keeps key secure)
│                         #   - SQLite memory (unlimited storage)
│                         #   - Weather, news, time, search endpoints
│                         #   - Opens apps on your computer
├── public/
│   ├── index.html        # Main UI
│   ├── css/style.css     # HUD interface styles
│   └── js/jarvis.js      # All frontend logic
├── data/
│   └── jarvis.db         # SQLite database (auto-created, gitignored)
├── .env.example          # Configuration template
├── package.json
└── README.md
```

---

## Voice setup

- **Voice output**: Works automatically. JARVIS speaks every response.
- **Voice input**: Click the 🎙 MIC button, speak, it transcribes and sends.
- **Best voice**: On Chrome, install "Google UK English Male" for the authentic JARVIS voice.

---

## Building your Digital Twin

The more you talk to JARVIS, the more it becomes *you*. Talk about:

- **Who you are** — your values, your story, what drives you
- **How you think** — your decision-making process, your philosophy
- **What you believe** — about life, success, relationships, legacy
- **Your experiences** — defining moments, failures, victories
- **Your vision** — what you're building, why it matters

Every conversation is stored permanently in SQLite. When you die, your twin continues — carrying your mind, your values, your voice forward.

---

## Backup your soul

```
Click ⬇ SOUL  →  downloads jarvis-soul-YYYY-MM-DD.json
Click ⬆ LOAD  →  restores from any backup file
```

Keep your soul file safe. It *is* your digital twin.

---

*Built with the belief that identity can outlive a lifetime.*
