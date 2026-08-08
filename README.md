# ⚡ Night Match — Personal Soccer Coach

A private, personal AI soccer coach. Ask anything about your game — technical or physical —
and get a **coach-style answer researched from live sources**, tuned to *your* profile.
Save favorite answers and generate structured multi-week training plans.

Built as a single static web app. No server, no build step, no install. Your data and API
key live **only in your browser** (localStorage) — nothing is uploaded anywhere except your
questions going directly to Google's Gemini API.

---

## 🚀 How to run it

**Option A — just open it**
Double-click `index.html`. That's it. (Some browsers restrict a couple of things on
`file://`, so Option B is smoother.)

**Option B — tiny local server (recommended)**
From this folder, run:

```bash
python3 -m http.server 8777
```

Then open **http://localhost:8777** in your browser.

---

## 🔑 One-time setup: your free Google API key

The coach needs a free Google Gemini key to research and answer.

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with any Google account.
3. Click **Create API key** → copy it (starts with `AIza…`).
4. In the app, open **Settings & API key** (bottom-left), paste it, click **Test key**, then **Save**.

- It's **free** — no credit card needed for the free tier.
- The key is stored **only on your device** and sent straight to Google, nowhere else.
- Free tier has generous daily limits; if you ever hit one, just wait a bit.

---

## 🧭 What's inside

- **Coach** — ask anything; get Quick Answer → Key Points → Drills, with cited sources.
- **Training Plans** — e.g. "get faster in 6 weeks" → a week-by-week program with drills.
- **Saved** — pin answers and plans to revisit anytime.
- **Profile** — level/age, position/foot, body/athleticism, goals/weaknesses. Every answer adapts to it. Editable anytime.

## 🎨 Design
"Touchline: floodlit tactics board" — an **ink-turf** (green-tinted near-black) base like a
floodlit pitch, **chalk** off-white type, and a single signature **flare vermilion** (`#FF4D2E`)
accent. Display type is **Barlow Condensed** (athletic, uppercase); body is **Barlow**. A faint
**chalk pitch diagram** (center circle, penalty boxes) reads through the background as the
signature motif. All icons are inline SVG (no emoji), with staggered reveals, expo easing, and
`prefers-reduced-motion` respected.

## 🔧 Tech
Vanilla HTML/CSS/JS. Gemini via `generativelanguage.googleapis.com` with Google Search
grounding (for live, cited answers). Training plans use Gemini JSON mode.

## 🗺️ Later (optional)
- Higgsfield/Kling hero imagery + a promo intro video (generate for free when your
  Higgsfield unlimited allowance is active).
- Progress tracking / streaks.
