// Proxies Google's ListModels using the server-side shared key.
// Same door policy as generate.js: only our own pages get an answer.

function allowedRequest(req) {
  const own = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ].filter(Boolean).map(h => h.toLowerCase());
  const ref = req.headers.origin || req.headers.referer || '';
  try { return own.includes(new URL(ref).hostname.toLowerCase()); }
  catch { return false; }
}

module.exports = async (req, res) => {
  if (!allowedRequest(req)) {
    return res.status(403).json({ error: { message: 'This endpoint only serves the Touchline app.' } });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server has no GEMINI_API_KEY configured.' } });
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': key } });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Upstream error: ' + e.message } });
  }
};
