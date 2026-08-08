// Lightweight probe so the frontend knows a shared backend key is configured.
// Does NOT call Google — just reports whether the secret exists on the server.
module.exports = (req, res) => {
  res.status(200).json({
    backend: true,
    keyConfigured: !!process.env.GEMINI_API_KEY,
  });
};
