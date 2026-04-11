import { head, put } from '@vercel/blob';

const DEFAULT = {
  Quin: Array(18).fill(''),
  Kasey: Array(18).fill(''),
  Marco: Array(18).fill(''),
  Conor: Array(18).fill(''),
  Pete: Array(18).fill(''),
  Luke: Array(18).fill(''),
  Greg: Array(18).fill(''),
  Dobon: Array(18).fill('')
};

const PATH = 'westchester-round/state.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Missing blob token' });

  if (req.method === 'GET') {
    try {
      const info = await head(PATH, { token });
      const response = await fetch(info.url);
      const json = await response.json();
      return res.status(200).json(json);
    } catch {
      return res.status(200).json(DEFAULT);
    }
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await put(PATH, JSON.stringify(body, null, 2), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
      contentType: 'application/json'
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
