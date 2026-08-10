// Proxies a Gemini generateContent call using the server-side shared key.
// The client sends { model, payload }; the key never reaches the browser.
//
// Two protections, both honest about their limits:
// 1. Origin check — only requests from this site's own pages are served.
// 2. Per-IP rate limit — a speed bump against someone hammering the shared
//    key. It lives in this serverless instance's memory, so it resets when
//    the instance recycles. It slows abuse; accounts will stop it properly.

const WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_PER_WINDOW = 25;         // requests per IP per window
const MAX_PAYLOAD_BYTES = 200_000; // chat history is text; nothing legit is bigger

const hits = new Map(); // ip -> { count, resetAt }

function allowedRequest(req) {
  // Hosts this deployment answers as. Vercel provides these automatically.
  const own = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL, // e.g. touchlinetrainer.vercel.app
    process.env.VERCEL_URL,                    // this exact deployment
    process.env.VERCEL_BRANCH_URL,             // branch preview, if any
  ].filter(Boolean).map(h => h.toLowerCase());

  const ref = req.headers.origin || req.headers.referer || '';
  try {
    const host = new URL(ref).hostname.toLowerCase();
    return own.includes(host);
  } catch {
    return false; // no Origin/Referer at all (curl, scripts) → not our page
  }
}

function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) hits.clear(); // don't let the map grow forever
    return false;
  }
  rec.count++;
  return rec.count > MAX_PER_WINDOW;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_PAYLOAD_BYTES) throw new Error('too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  if (!allowedRequest(req)) {
    return res.status(403).json({ error: { message: 'This endpoint only serves the Touchline app.' } });
  }
  if (rateLimited(req)) {
    return res.status(429).json({ error: { message: 'Slow down — too many requests from your connection. Try again in a few minutes.' } });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server has no GEMINI_API_KEY configured.' } });

  try {
    const { model, payload } = await readJson(req);
    if (!model || !payload) return res.status(400).json({ error: { message: 'Missing model or payload.' } });
    // allow only Gemini models to be proxied
    if (!/^gemini[\w.\-]*$/.test(model)) return res.status(400).json({ error: { message: 'Invalid model.' } });
    if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: { message: 'Request too large.' } });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload) }
    );
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    if (e.message === 'too large') return res.status(413).json({ error: { message: 'Request too large.' } });
    return res.status(502).json({ error: { message: 'Upstream error: ' + e.message } });
  }
};
