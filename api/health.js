export default function handler(req, res) {
  res.setHeader("Content-Security-Policy", "frame-ancestors https:");
  res.status(200).json({ ok: true, now: new Date().toISOString() });
}
