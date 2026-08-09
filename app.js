/* ============================================================
   NIGHT MATCH — app logic
   Static, local-first. Data + API key live in localStorage.
   ============================================================ */

const store = {
  get:  (k, d = null) => { try { const v = localStorage.getItem('nm_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set:  (k, v) => localStorage.setItem('nm_' + k, JSON.stringify(v)),
  del:  (k) => localStorage.removeItem('nm_' + k),
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------- SVG icons (no emoji-as-icons) ---------------- */
const SVG = {
  zap:      '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  target:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/></svg>',
  activity: '<svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
};
function sectionIcon(title) {
  const l = String(title).toLowerCase();
  if (l.includes('drill')) return SVG.activity;
  if (l.includes('key')) return SVG.target;
  return SVG.zap;
}
const WARN = '<svg viewBox="0 0 24 24" style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-4px;margin-right:6px"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

/* ---------------- shared backend detection ----------------
   On Vercel a serverless proxy (/api/*) holds one shared key so visitors
   don't need their own. Locally (static host) there's no /api, so the app
   falls back to a per-browser key. A user-entered key always takes priority. */
let backendReady = false, backendKey = false;
async function checkBackend() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      backendReady = !!d.backend;
      backendKey = !!d.keyConfigured;
    }
  } catch { /* no backend (local/static) */ }
  refreshKeyStatus();
}
// true when the coach can run: either the visitor set their own key, or a shared key is live.
function canCoach() { return !!store.get('apiKey') || (backendReady && backendKey); }

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (ok ? ' ok' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast hidden'), 2600);
}

/* =====================================================================
   ONBOARDING
   ===================================================================== */
const onbState = { step: 0, foot: '', build: '' };
const TOTAL_STEPS = 4;

function initOnboarding() {
  // segmented controls
  $$('.seg').forEach(seg => {
    seg.addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      $$('.seg-btn', seg).forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      onbState[seg.dataset.name] = btn.dataset.val;
    });
  });
  // range live values
  const bind = (name, label) => {
    const el = $(`[name="${name}"]`, $('#onbForm'));
    if (el) el.addEventListener('input', () => ($('#' + label).textContent = el.value));
  };
  bind('speed', 'speedVal'); bind('strength', 'strengthVal');

  $('#onbNext').addEventListener('click', onbNext);
  $('#onbBack').addEventListener('click', onbBack);
  showStep(0);
}

function showStep(n) {
  onbState.step = n;
  $$('.onb-step').forEach(s => s.classList.toggle('hidden', +s.dataset.step !== n));
  $('#onbBar').style.width = ((n + 1) / TOTAL_STEPS * 100) + '%';
  $('#onbBack').style.visibility = n === 0 ? 'hidden' : 'visible';
  $('#onbNext').textContent = n === TOTAL_STEPS - 1 ? 'Enter Night Match' : 'Continue';
}

function validateStep(n) {
  const form = $('#onbForm');
  if (n === 0) {
    if (!form.level.value) return toast('Pick your level', false), false;
    if (!form.age.value)   return toast('Add your age', false), false;
  }
  if (n === 1) {
    if (!form.position.value) return toast('Pick a position', false), false;
    if (!onbState.foot)       return toast('Pick your dominant foot', false), false;
  }
  return true;
}

function onbNext() {
  if (!validateStep(onbState.step)) return;
  if (onbState.step < TOTAL_STEPS - 1) showStep(onbState.step + 1);
  else finishOnboarding();
}
function onbBack() { if (onbState.step > 0) showStep(onbState.step - 1); }

function finishOnboarding() {
  const f = $('#onbForm');
  const profile = {
    level: f.level.value, age: f.age.value,
    position: f.position.value, foot: onbState.foot,
    height: f.height.value.trim(), build: onbState.build || '—',
    speed: f.speed.value, strength: f.strength.value,
    goals: f.goals.value.trim(), weaknesses: f.weaknesses.value.trim(),
  };
  store.set('profile', profile);
  $('#onboarding').classList.add('hidden');
  bootApp();
  toast('Profile saved');
}

/* =====================================================================
   PROFILE VIEW
   ===================================================================== */
function renderProfile() {
  const p = store.get('profile'); if (!p) return;
  const rows = [
    ['Level', p.level], ['Age', p.age],
    ['Position', p.position], ['Dominant foot', p.foot],
    ['Height', p.height || '—'], ['Build', p.build],
    ['Speed (self-rated)', p.speed + '/5'], ['Strength (self-rated)', p.strength + '/5'],
    ['Goals', p.goals || '—'], ['Weaknesses', p.weaknesses || '—'],
  ];
  $('#profileCard').innerHTML = rows.map(([k, v]) =>
    `<div class="prof-row"><span class="prof-k">${k}</span><span class="prof-v">${esc(v)}</span></div>`).join('');

  const first = (p.goals || '').split(/[.,]/)[0] || 'your game';
  $('#welcomeSub').textContent = `${p.position} • ${p.level} • tuned to your goals. Ask anything technical or physical — I coach it for you.`;
}

function profileSummary() {
  const p = store.get('profile'); if (!p) return '';
  return `Player profile:
- Level: ${p.level}
- Age: ${p.age}
- Position: ${p.position}
- Dominant foot: ${p.foot}
- Height: ${p.height || 'not given'}
- Build: ${p.build}
- Self-rated speed: ${p.speed}/5
- Self-rated strength: ${p.strength}/5
- Goals: ${p.goals || 'not given'}
- Weaknesses to fix: ${p.weaknesses || 'not given'}`;
}

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function initNav() {
  $$('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}
function switchView(view) {
  $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'saved') renderSaved();
  if (view === 'profile') renderProfile();
}

/* =====================================================================
   SETTINGS / API KEY
   ===================================================================== */
function initSettings() {
  $('#openSettings').addEventListener('click', openSettings);
  $('[data-close="settings"]').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') e.target.classList.add('hidden'); });
  $('#saveKey').addEventListener('click', saveKey);
  $('#testKey').addEventListener('click', testKey);
  refreshKeyStatus();
}
const DEFAULT_MODEL = 'gemini-flash-latest';

function openSettings() {
  $('#apiKeyInput').value = store.get('apiKey', '') || '';
  $('#groundingToggle').checked = store.get('grounding', false);
  $('#keyMsg').textContent = '';
  const sharedNote = $('#sharedNote');
  if (sharedNote) sharedNote.classList.toggle('hidden', !(backendReady && backendKey));
  $('#settingsModal').classList.remove('hidden');
  if (store.get('apiKey') || (backendReady && backendKey)) loadModels().catch(() => {});
  else $('#modelSelect').value = store.get('model', DEFAULT_MODEL);
}
function saveKey() {
  const key = $('#apiKeyInput').value.trim();
  store.set('apiKey', key);
  store.set('model', $('#modelSelect').value || DEFAULT_MODEL);
  store.set('grounding', $('#groundingToggle').checked);
  refreshKeyStatus();
  toast(key ? 'Settings saved' : 'API key cleared');
  $('#settingsModal').classList.add('hidden');
}
async function testKey() {
  const key = $('#apiKeyInput').value.trim();
  const msg = $('#keyMsg');
  if (!key) { msg.className = 'key-msg err'; msg.textContent = 'Paste a key first.'; return; }
  msg.className = 'key-msg'; msg.textContent = 'Checking your key and available models…';
  try {
    store.set('apiKey', key);
    // Listing models validates the key without spending a generation request (saves quota).
    await loadModels();
    store.set('model', $('#modelSelect').value);
    msg.className = 'key-msg ok'; msg.textContent = '✓ Key works — using ' + $('#modelSelect').value;
    refreshKeyStatus();
  } catch (e) {
    msg.className = 'key-msg err'; msg.textContent = '✗ ' + e.message;
  }
}

/* Ask the key which models it can use, and fill the dropdown. Keeps us
   compatible with any account — no hardcoded model that might be unavailable. */
async function loadModels() {
  const ownKey = store.get('apiKey');
  let res;
  if (ownKey) res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(ownKey)}&pageSize=200`);
  else if (backendReady) res = await fetch('/api/models');
  else throw new Error('Add your API key first, or deploy the shared backend.');
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Could not list models.');

  let names = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => n.startsWith('gemini') && !/embedding|aqa|image|tts|vision-latest/i.test(n));

  // rank for best free-tier throughput: flash family first, lite preferred (highest limits),
  // stable '-latest' aliases over dated ones, newer versions slightly favored, avoid experimental.
  const score = n => {
    let s = n.includes('flash') ? 0 : n.includes('pro') ? 40 : 80;
    if (n.includes('lite')) s -= 25;
    if (n.includes('latest')) s -= 8;
    s -= parseFloat((n.match(/\d\.\d/) || [0])[0]);
    if (/preview|exp|thinking|image|tts/.test(n)) s += 40;
    return s;
  };
  names = [...new Set(names)].sort((a, b) => score(a) - score(b));
  if (!names.length) throw new Error('This key has no usable text models.');

  const sel = $('#modelSelect');
  const label = n => n + (n === names[0] ? '  (recommended)' : '');
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(label(n))}</option>`).join('');

  // keep the saved choice if still valid, else pick the top-ranked model
  const saved = store.get('model');
  const chosen = names.includes(saved) ? saved : names[0];
  sel.value = chosen;
  store.set('model', chosen);
  return names;
}

/* On boot: if a key exists but the stored model is stale/unavailable,
   silently swap to a valid one so the coach just works. */
async function reconcileModel() {
  if (!store.get('apiKey') && !(backendReady && backendKey)) return;
  try { await loadModels(); } catch { /* offline / bad key — surfaced when they ask */ }
}
function refreshKeyStatus() {
  let dot = 'off', text = 'No API key';
  if (store.get('apiKey')) { dot = 'on'; text = 'Using your key'; }
  else if (backendReady && backendKey) { dot = 'on'; text = 'Coach ready'; }
  else if (backendReady && !backendKey) { dot = 'off'; text = 'Server key not set'; }
  const el = $('#keyStatus');
  if (el) el.innerHTML = `<span class="dot dot--${dot}"></span><span class="key-status-text">${text}</span>`;
}

/* =====================================================================
   GEMINI API
   ===================================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let retryNotifier = null;   // views set this to show "retrying in Xs…" feedback

// Google returns a RetryInfo detail like { retryDelay: "37s" } on 429s.
function parseRetryDelay(data) {
  for (const d of data?.error?.details || []) {
    if (typeof d.retryDelay === 'string') {
      const m = d.retryDelay.match(/([\d.]+)s/);
      if (m) return Math.ceil(parseFloat(m[1]));
    }
  }
  return null;
}

async function callGemini(systemInstruction, userText, useGrounding = true, jsonMode = false, _retry = false) {
  const ownKey = store.get('apiKey');
  if (!ownKey && !(backendReady && backendKey))
    throw new Error('No coach access yet — add your API key in Settings (or set the shared key on the server).');
  const model = store.get('model', DEFAULT_MODEL);

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
  };
  // older 1.5 models use google_search_retrieval; 2.0+ use google_search
  if (useGrounding) payload.tools = [/gemini-1\.5|gemini-1\.0/.test(model) ? { google_search_retrieval: {} } : { google_search: {} }];
  if (jsonMode) payload.generationConfig = { responseMimeType: 'application/json', temperature: 0.7 };

  const MAX_429 = 4;
  for (let attempt = 0; ; attempt++) {
    let res, data;
    try {
      if (ownKey) {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(ownKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, payload }) });
      }
      data = await res.json();
    } catch { throw new Error('Network error — check your connection.'); }

    if (res.ok) {
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map(p => p.text).filter(Boolean).join('\n').trim();
      const chunks = cand?.groundingMetadata?.groundingChunks || [];
      const seen = new Set();
      const sources = chunks.filter(c => c.web?.uri).map(c => c.web).filter(w => (seen.has(w.uri) ? false : seen.add(w.uri)));
      if (!text) throw new Error('Empty response — try rephrasing.');
      return { text, sources };
    }

    const m = data?.error?.message || `Request failed (${res.status})`;

    // stale/unavailable model → rediscover what this key supports and retry once
    if (!_retry && (res.status === 404 || /no longer available|not found|not supported|is not found/i.test(m))) {
      try {
        await loadModels();
        return await callGemini(systemInstruction, userText, useGrounding, jsonMode, true);
      } catch { /* fall through */ }
    }

    // rate limit → honor Google's retry delay and wait it out
    if (res.status === 429) {
      const wait = parseRetryDelay(data) ?? Math.min(30, 5 * 2 ** attempt);
      if (attempt < MAX_429 && wait <= 60) {
        if (retryNotifier) retryNotifier(`Free-tier rate limit — retrying in ${wait}s (${attempt + 1}/${MAX_429})…`);
        await sleep(wait * 1000);
        continue;
      }
      throw new Error(`Rate limit reached. The free tier allows only a few requests per minute — wait ${wait ? '~' + wait + 's' : 'a minute'} and try again, or switch to a lighter model (e.g. flash-lite) in Settings.`);
    }

    if (res.status === 400 && /API key not valid/i.test(m)) throw new Error("That API key isn't valid.");
    throw new Error(m);
  }
}

/* =====================================================================
   COACH CHAT
   ===================================================================== */
function coachSystemPrompt() {
  return `You are "Night Match", an elite personal soccer (football) coach for ONE athlete.
${profileSummary()}

RULES:
- Tailor everything to THIS athlete's level, age, position, foot, body and goals. Reference their profile naturally.
- Cover BOTH technical (skills, moves, decisions) and physical (speed, strength, conditioning) sides when relevant.
- Use up-to-date, trustworthy knowledge. Prefer established coaching principles and reputable sources.
- Be specific and actionable. No fluff. Speak like a sharp, encouraging coach.
- For young athletes, keep physical training age-appropriate and safe.

FORMAT your answer in GitHub markdown using EXACTLY these three section headers, in this order:

## Quick Answer
(2-4 sentences: the core of the answer, tailored to them.)

## Key Points
(4-7 bullet points. Mix technical and physical. Concrete.)

## Drills to Practice
(3-5 numbered drills they can actually do, with reps/time and why each helps.)

Do not add other top-level headers. Keep it focused.`;
}

const messages = [];
let busy = false;

function initCoach() {
  const form = $('#composer');
  const input = $('#composerInput');
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); sendMessage(input.value.trim()); });
  renderChips();
}

function renderChips() {
  const p = store.get('profile') || {};
  const chips = [
    'How do I beat a bigger, stronger defender?',
    'How do I get faster for soccer?',
    `Best drills for a ${p.position || 'player'} at my level`,
    p.weaknesses ? `Help me fix: ${p.weaknesses.split(/[.,]/)[0]}` : 'How do I improve my weak foot?',
    'A warm-up routine before games',
  ];
  $('#starterChips').innerHTML = chips.map(c => `<button class="chip">${esc(c)}</button>`).join('');
  $$('#starterChips .chip').forEach(c => c.addEventListener('click', () => sendMessage(c.textContent)));
}

async function sendMessage(text) {
  if (!text || busy) return;
  if (!canCoach()) { openSettings(); toast('Add your free API key to start', false); return; }

  $('#chatWelcome').classList.add('hidden');
  const input = $('#composerInput'); input.value = ''; input.style.height = 'auto';
  busy = true; $('#sendBtn').disabled = true;

  addUserMsg(text);
  const thinkEl = addThinking();
  const wantGrounding = store.get('grounding', false);
  setThinking(thinkEl, wantGrounding ? 'Researching trusted sources…' : 'Thinking through your game…');
  retryNotifier = t => setThinking(thinkEl, t);

  try {
    let answer, sources, degraded = false;
    try {
      ({ text: answer, sources } = await callGemini(coachSystemPrompt(), text, wantGrounding));
    } catch (e1) {
      // If live search is what's rate-limited/unsupported, still get an answer without it.
      if (wantGrounding && /rate limit|quota|429|search|grounding|tool|not supported/i.test(e1.message)) {
        setThinking(thinkEl, 'Live sources are rate-limited — answering from coach knowledge…');
        retryNotifier = t => setThinking(thinkEl, t);
        ({ text: answer, sources } = await callGemini(coachSystemPrompt(), text, false));
        degraded = true;
      } else { throw e1; }
    }
    thinkEl.remove();
    addCoachMsg(text, answer, sources, degraded);
  } catch (e) {
    thinkEl.remove();
    addErrorMsg(e.message);
  } finally {
    retryNotifier = null;
    busy = false; $('#sendBtn').disabled = false;
    scrollChat();
  }
}

function addUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg msg-user';
  el.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  $('#messages').appendChild(el); scrollChat();
}

function addThinking() {
  const el = document.createElement('div');
  el.className = 'msg msg-coach';
  el.innerHTML = `<div class="thinking"><div class="think-dots"><i></i><i></i><i></i></div> Researching trusted sources…</div>`;
  $('#messages').appendChild(el); scrollChat();
  return el;
}
function setThinking(el, msg) {
  el.innerHTML = `<div class="thinking"><div class="think-dots"><i></i><i></i><i></i></div> ${esc(msg)}</div>`;
  scrollChat();
}

function addCoachMsg(question, answer, sources, degraded = false) {
  const el = document.createElement('div');
  el.className = 'msg msg-coach';
  el.innerHTML = coachAnswerHTML(answer, sources, degraded);
  $('#messages').appendChild(el);
  wireSaveBtn(el, { type: 'answer', question, text: answer, sources });
}

function coachAnswerHTML(answer, sources, degraded = false) {
  const sections = parseSections(answer);
  let inner = '';
  for (const s of sections) {
    const low = s.title.toLowerCase();
    if (low.includes('quick')) {
      inner += `<div class="ans-quick">${mdInline(s.body).replace(/^<p>|<\/p>$/g, '')}</div>`;
    } else {
      inner += `<div class="ans-block"><div class="ans-h">${sectionIcon(s.title)} ${esc(s.title)}</div><div class="ans-body">${mdBlock(s.body)}</div></div>`;
    }
  }
  if (!sections.length) inner = `<div class="ans-body">${mdBlock(answer)}</div>`;
  if (degraded) inner += `<div class="degraded-note">Answered from coach knowledge — live web sources were rate-limited.</div>`;

  let src = '';
  if (sources && sources.length) {
    src = `<div class="sources"><div class="sources-title">Sources</div><div class="source-pills">` +
      sources.slice(0, 8).map((s, i) =>
        `<a class="source-pill" href="${esc(s.uri)}" target="_blank" rel="noopener"><span class="src-num">${i + 1}</span><span class="src-t">${esc(s.title || hostOf(s.uri))}</span></a>`
      ).join('') + `</div></div>`;
  }

  return `<div class="coach-head"><div class="coach-avatar">NM</div><div class="coach-name">Night Match <small>your coach</small></div></div>
    <div class="answer">${inner}${src}
      <div class="ans-actions">
        <button class="icon-btn save-btn"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Save</button>
        <button class="icon-btn copy-btn"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button>
      </div></div>`;
}

function wireSaveBtn(el, item) {
  const saveBtn = $('.save-btn', el);
  const copyBtn = $('.copy-btn', el);
  saveBtn?.addEventListener('click', () => {
    const saved = store.get('saved', []);
    saved.unshift({ id: uid(), ts: Date.now(), ...item });
    store.set('saved', saved);
    saveBtn.classList.add('saved');
    saveBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Saved`;
    toast('Saved to your library');
  });
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(item.text).then(() => toast('Copied'));
  });
}

function addErrorMsg(msg) {
  const el = document.createElement('div');
  el.className = 'msg msg-coach';
  el.innerHTML = `<div class="coach-head"><div class="coach-avatar">NM</div><div class="coach-name">Night Match</div></div>
    <div class="ans-quick" style="border-color:rgba(255,122,107,.4)">${WARN}${esc(msg)}</div>`;
  $('#messages').appendChild(el);
}

function scrollChat() { const s = $('#chatScroll'); s.scrollTop = s.scrollHeight; }

/* =====================================================================
   TRAINING PLANS
   ===================================================================== */
function initPlans() {
  $('#planForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!canCoach()) { openSettings(); toast('Add your free API key first', false); return; }
    const f = e.target;
    const goal = f.goal.value.trim(); if (!goal) return;
    const weeks = f.weeks.value, days = f.days.value;
    const btn = $('button', f); const orig = btn.textContent;
    btn.textContent = 'Building…'; btn.disabled = true;
    $('#planResult').innerHTML = `<div class="thinking"><div class="think-dots"><i></i><i></i><i></i></div> Designing your ${weeks}-week program…</div>`;

    const sys = `You are an elite personal soccer strength & skills coach. Build a periodized training plan for this athlete.
${profileSummary()}

Return ONLY valid JSON (no markdown) with this exact shape:
{
 "title": "string",
 "overview": "2-3 sentence summary of the approach, tailored to them",
 "weeks": [
   { "week": 1, "focus": "short focus label",
     "days": [ { "day": "Day 1 — label", "detail": "specific session: drills, sets/reps/time, and 1 coaching cue" } ] }
 ]
}
Make exactly ${weeks} weeks and ${days} training days per week. Progress difficulty across weeks. Keep it safe and age-appropriate. Be concrete.`;

    retryNotifier = t => { $('#planResult').innerHTML = `<div class="thinking"><div class="think-dots"><i></i><i></i><i></i></div> ${esc(t)}</div>`; };
    try {
      const { text } = await callGemini(sys, `Goal: ${goal}. ${weeks} weeks, ${days} days/week.`, false, true);
      const plan = JSON.parse(cleanJSON(text));
      renderPlan(plan, goal);
      toast('Plan ready');
    } catch (err) {
      $('#planResult').innerHTML = `<div class="ans-quick" style="border-color:rgba(255,122,107,.4)">${WARN}${esc(err.message)}</div>`;
    } finally {
      retryNotifier = null;
      btn.textContent = orig; btn.disabled = false;
    }
  });
}

function renderPlan(plan, goal) {
  const weeksHTML = (plan.weeks || []).map((w, i) => `
    <div class="week ${i === 0 ? 'open' : ''}">
      <div class="week-head">
        <div><div class="week-num">Week <span>${w.week ?? i + 1}</span></div><div class="week-focus">${esc(w.focus || '')}</div></div>
        <svg class="week-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="week-body">
        ${(w.days || []).map(d => `<div class="day-row"><div class="day-name">${esc(d.day || '')}</div><div class="day-detail">${esc(d.detail || '')}</div></div>`).join('')}
      </div>
    </div>`).join('');

  $('#planResult').innerHTML = `
    <div class="plan-overview">
      <h2>${esc(plan.title || goal)}</h2>
      <p>${esc(plan.overview || '')}</p>
      <div class="ans-actions"><button class="icon-btn save-plan"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Save plan</button></div>
    </div>
    ${weeksHTML}`;

  $$('#planResult .week-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
  $('#planResult .save-plan').addEventListener('click', e => {
    const saved = store.get('saved', []);
    saved.unshift({ id: uid(), ts: Date.now(), type: 'plan', question: plan.title || goal, plan });
    store.set('saved', saved);
    e.currentTarget.classList.add('saved');
    e.currentTarget.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Saved`;
    toast('Plan saved');
  });
}

/* =====================================================================
   SAVED LIBRARY
   ===================================================================== */
function renderSaved() {
  const saved = store.get('saved', []);
  const list = $('#savedList');
  if (!saved.length) {
    list.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      <h3>Nothing saved yet</h3><p>Pin great answers and training plans and they'll show up here to revisit anytime.</p></div>`;
    return;
  }
  list.innerHTML = saved.map(item => {
    const kind = item.type === 'plan' ? 'PLAN' : item.type === 'analysis' ? 'ANALYSIS' : 'ANSWER';
    let snippet = '';
    if (item.type === 'plan') snippet = item.plan?.overview || '';
    else if (item.type === 'analysis') snippet = item.analysis?.report?.coachNote || item.analysis?.report?.headline || '';
    else snippet = (parseSections(item.text || '')[0]?.body || item.text || '').slice(0, 180);
    return `<div class="saved-item" data-id="${item.id}">
      <button class="saved-x" data-del="${item.id}" title="Remove">&times;</button>
      <div class="saved-q">${esc(item.question)}</div>
      <div class="saved-meta"><span class="saved-tag">${kind}</span><span>${timeAgo(item.ts)}</span></div>
      <div class="saved-snippet">${esc(snippet)}</div>
      <div class="saved-full hidden"></div>
    </div>`;
  }).join('');

  $$('#savedList .saved-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      const full = $('.saved-full', el);
      const item = store.get('saved', []).find(s => s.id === el.dataset.id);
      if (!item) return;
      if (full.classList.contains('hidden')) {
        full.innerHTML = item.type === 'plan' ? planStaticHTML(item.plan)
          : item.type === 'analysis' ? analysisStaticHTML(item.analysis)
          : coachAnswerStaticHTML(item.text, item.sources);
        full.classList.remove('hidden');
        $('.saved-snippet', el).style.display = 'none';
      } else {
        full.classList.add('hidden'); full.innerHTML = '';
        $('.saved-snippet', el).style.display = '';
      }
    });
  });
  $$('#savedList [data-del]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = b.dataset.del;
    store.set('saved', store.get('saved', []).filter(s => s.id !== id));
    renderSaved(); toast('Removed');
  }));
}

function coachAnswerStaticHTML(text, sources) {
  const sections = parseSections(text);
  let inner = sections.map(s => {
    const low = s.title.toLowerCase();
    if (low.includes('quick')) return `<div class="ans-quick">${mdInline(s.body).replace(/^<p>|<\/p>$/g, '')}</div>`;
    return `<div class="ans-block"><div class="ans-h">${sectionIcon(s.title)} ${esc(s.title)}</div><div class="ans-body">${mdBlock(s.body)}</div></div>`;
  }).join('') || `<div class="ans-body">${mdBlock(text)}</div>`;
  if (sources?.length) inner += `<div class="sources"><div class="sources-title">Sources</div><div class="source-pills">` +
    sources.slice(0, 8).map((s, i) => `<a class="source-pill" href="${esc(s.uri)}" target="_blank" rel="noopener"><span class="src-num">${i + 1}</span><span class="src-t">${esc(s.title || hostOf(s.uri))}</span></a>`).join('') + `</div></div>`;
  return `<div style="margin-top:16px">${inner}</div>`;
}
function analysisStaticHTML(a) {
  if (!a) return '';
  const r = a.report || {}, m = a.metrics || {};
  const rows = [
    // sprint metrics
    ['Cadence', m.cadence, 'steps/sec'], ['Knee drive', m.kneeDriveDeg, '°'],
    ['Step symmetry', m.stepSymmetryPct, '%'], ['Arm symmetry', m.armSymmetryPct, '%'],
    ['Top speed', m.estTopSpeedMps, 'm/s'],
    // shooting metrics
    ['Plant offset', m.plantOffsetCm, 'cm'], ['Knee over ball', m.kneeOverBallDeg, '°'],
    ['Follow-through', m.followThroughDeg, '°'], ['Head movement', m.headMoveCm, 'cm'],
    // shared
    ['Trunk lean', m.trunkLeanDeg, '°'],
  ].filter(x => x[1] !== null && x[1] !== undefined);
  return `<div style="margin-top:16px">
    ${r.headline ? `<div class="ans-quick">${esc(r.headline)}</div>` : ''}
    <div class="az-fixes">${(r.fixes || []).map(f => `
      <article class="az-fix">
        <div class="az-fix-rank">${f.rank ?? ''}</div>
        <div class="az-fix-body">
          <div class="az-fix-top"><h3>${esc(f.title || '')}</h3></div>
          ${f.observed ? `<p class="az-fix-obs">${esc(f.observed)}</p>` : ''}
          ${f.why ? `<p class="az-fix-why">${esc(f.why)}</p>` : ''}
          ${f.drill ? `<p class="az-fix-drill"><span>Drill</span>${esc(f.drill)}</p>` : ''}
        </div>
      </article>`).join('')}</div>
    ${r.coachNote ? `<p class="az-fix-why" style="margin-top:12px">${esc(r.coachNote)}</p>` : ''}
    <div class="az-metric-grid" style="margin-top:14px">
      ${rows.map(([k, v, u]) => `<div class="az-metric"><span class="az-metric-v">${v}<small>${u}</small></span><span class="az-metric-k">${k}</span></div>`).join('')}
    </div>
  </div>`;
}

function planStaticHTML(plan) {
  return `<div style="margin-top:16px">` + (plan.weeks || []).map((w, i) =>
    `<div class="week open"><div class="week-head"><div><div class="week-num">Week <span>${w.week ?? i + 1}</span></div><div class="week-focus">${esc(w.focus || '')}</div></div></div>
     <div class="week-body">${(w.days || []).map(d => `<div class="day-row"><div class="day-name">${esc(d.day || '')}</div><div class="day-detail">${esc(d.detail || '')}</div></div>`).join('')}</div></div>`
  ).join('') + `</div>`;
}

/* =====================================================================
   MARKDOWN (tiny renderer)
   ===================================================================== */
function parseSections(md) {
  if (!md) return [];
  const parts = md.split(/^\s*#{1,3}\s+/m).map(s => s.trim()).filter(Boolean);
  // If there were headers, first split piece may be preamble w/o title
  const out = [];
  const re = /^\s*#{1,3}\s+(.+)$/gm;
  let m, indices = [];
  while ((m = re.exec(md)) !== null) indices.push({ title: m[1].trim(), start: m.index + m[0].length });
  if (!indices.length) return [];
  for (let i = 0; i < indices.length; i++) {
    const body = md.slice(indices[i].start, i + 1 < indices.length ? md.lastIndexOf('\n', indices[i + 1].start) : undefined).trim();
    out.push({ title: indices[i].title.replace(/[⚡🎯🏃]/g, '').trim(), body });
  }
  return out;
}
function mdInline(t) {
  return esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}
function mdBlock(md) {
  const lines = md.split('\n'); let html = '', list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
    if ((m = line.match(/^(\d+)[.)]\s+(.*)/))) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${mdInline(m[2])}</li>`;
    } else if ((m = line.match(/^[-*•]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${mdInline(m[1])}</li>`;
    } else {
      closeList();
      html += `<p>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}
function cleanJSON(t) {
  return t.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
}

/* ---------------- utils ---------------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } }
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* =====================================================================
   BOOT
   ===================================================================== */
function bootApp() {
  $('#app').classList.remove('hidden');
  renderProfile();
  renderChips();
}

function init() {
  initNav();
  initSettings();
  initCoach();
  initPlans();
  if (typeof initAnalyze === 'function') initAnalyze();
  if (typeof initShoot === 'function') initShoot();
  $('#editProfile').addEventListener('click', () => {
    // prefill onboarding from existing profile
    const p = store.get('profile'); if (!p) return;
    const f = $('#onbForm');
    f.level.value = p.level; f.age.value = p.age; f.position.value = p.position;
    f.height.value = p.height; f.goals.value = p.goals; f.weaknesses.value = p.weaknesses;
    f.speed.value = p.speed; f.strength.value = p.strength;
    $('#speedVal').textContent = p.speed; $('#strengthVal').textContent = p.strength;
    onbState.foot = p.foot; onbState.build = p.build;
    $$('.seg').forEach(seg => $$('.seg-btn', seg).forEach(b =>
      b.classList.toggle('on', b.dataset.val === onbState[seg.dataset.name])));
    showStep(0);
    $('#onboarding').classList.remove('hidden');
  });

  if (store.get('profile')) bootApp();
  else $('#onboarding').classList.remove('hidden');

  // detect the shared backend, then make sure the stored model is one we can use
  checkBackend().then(reconcileModel);
}

document.addEventListener('DOMContentLoaded', () => { initOnboarding(); init(); });
