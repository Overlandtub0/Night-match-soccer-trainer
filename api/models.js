// Proxies Google's ListModels using the server-side shared key.
// Lets the frontend populate the model dropdown without exposing the key.
module.exports = async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server has no GEMINI_API_KEY configured.' } });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Upstream error: ' + e.message } });
  }
};
