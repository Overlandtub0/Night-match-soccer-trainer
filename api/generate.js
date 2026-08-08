// Proxies a Gemini generateContent call using the server-side shared key.
// The client sends { model, payload }; the key is never exposed to the browser.
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server has no GEMINI_API_KEY configured.' } });

  try {
    const { model, payload } = await readJson(req);
    if (!model || !payload) return res.status(400).json({ error: { message: 'Missing model or payload.' } });
    // allow only Gemini models to be proxied
    if (!/^gemini[\w.\-]*$/.test(model)) return res.status(400).json({ error: { message: 'Invalid model.' } });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Upstream error: ' + e.message } });
  }
};
