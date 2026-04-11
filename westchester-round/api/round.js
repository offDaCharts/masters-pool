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

let state = globalThis.__WESTCHESTER_STATE || structuredClone(DEFAULT);
globalThis.__WESTCHESTER_STATE = state;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json(state);
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    state = body;
    globalThis.__WESTCHESTER_STATE = state;
    return res.status(200).json({ ok: true, state });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
