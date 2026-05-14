// Vercel serverless proxy for The Odds API — PGA Championship outright winner odds.
// - Hides the API key (env var ODDS_API_KEY).
// - Caches the upstream response in process memory so one upstream call serves all clients.
// - Cache TTL is 15 min during play hours (Thu–Sun, 6am–9pm ET) and 4 hr otherwise.
// - Returns vig-removed implied win probabilities averaged across bookmakers.

const UPSTREAM = 'https://api.the-odds-api.com/v4/sports/golf_pga_championship_winner/odds';

const PLAY_HOURS_TTL_MS = 15 * 60 * 1000;
const OFF_HOURS_TTL_MS = 4 * 60 * 60 * 1000;

// Tournament play window in America/New_York time.
// Thu 5/14 → Sun 5/17, inclusive. 06:00 – 21:00 ET each day.
const PLAY_WINDOW_DAYS = new Set(['Thu', 'Fri', 'Sat', 'Sun']);
const PLAY_HOUR_START = 6;
const PLAY_HOUR_END = 21;

function ttlForNow(now = new Date()) {
  // Returns the cache TTL appropriate for the current ET time.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: 'numeric',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hourStr = parts.find(p => p.type === 'hour')?.value;
  const hour = parseInt(hourStr, 10);
  const inPlay =
    PLAY_WINDOW_DAYS.has(weekday) &&
    hour >= PLAY_HOUR_START &&
    hour < PLAY_HOUR_END;
  return inPlay ? PLAY_HOURS_TTL_MS : OFF_HOURS_TTL_MS;
}

function americanToImplied(odds) {
  if (typeof odds !== 'number' || !isFinite(odds)) return null;
  if (odds > 0) return 100 / (odds + 100);
  if (odds < 0) return -odds / (-odds + 100);
  return null;
}

function normalize(upstreamJson) {
  // Upstream shape (outrights):
  // [
  //   {
  //     id, sport_key, sport_title, commence_time, ...
  //     bookmakers: [
  //       { key, title, markets: [ { key: 'outrights', outcomes: [ { name, price } ] } ] }
  //     ]
  //   }
  // ]
  if (!Array.isArray(upstreamJson) || upstreamJson.length === 0) {
    return { golfers: [], bookmakerCount: 0 };
  }

  // The PGA Championship outright is a single "event"; if multiple are returned we merge.
  const perBook = []; // [ { golferImplied: Map<name, vigFreeProb> } ]

  for (const event of upstreamJson) {
    const books = event.bookmakers || [];
    for (const book of books) {
      const market = (book.markets || []).find(m => m.key === 'outrights');
      if (!market || !Array.isArray(market.outcomes)) continue;

      // Compute this book's overround across all listed golfers in this event.
      const raw = new Map();
      let overround = 0;
      for (const oc of market.outcomes) {
        const p = americanToImplied(oc.price);
        if (p === null) continue;
        raw.set(oc.name, p);
        overround += p;
      }
      if (overround <= 0) continue;

      const vigFree = new Map();
      for (const [name, p] of raw) {
        vigFree.set(name, p / overround);
      }
      perBook.push({ bookKey: book.key, golferImplied: vigFree });
    }
  }

  // Average each golfer's vig-free probability across all books that listed them.
  const sums = new Map();
  const counts = new Map();
  for (const { golferImplied } of perBook) {
    for (const [name, p] of golferImplied) {
      sums.set(name, (sums.get(name) || 0) + p);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  const golfers = [];
  for (const [name, total] of sums) {
    const n = counts.get(name) || 1;
    golfers.push({ name, impliedWinProb: total / n, bookmakerCount: n });
  }

  // Sort by probability descending for readability.
  golfers.sort((a, b) => b.impliedWinProb - a.impliedWinProb);

  return { golfers, bookmakerCount: perBook.length };
}

async function fetchUpstream() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error('ODDS_API_KEY env var is not set');
  }
  const url =
    `${UPSTREAM}?regions=us&markets=outrights&oddsFormat=american&apiKey=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url);
  const remaining = resp.headers.get('x-requests-remaining');
  const used = resp.headers.get('x-requests-used');
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Odds API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const normalized = normalize(json);
  return {
    fetchedAt: new Date().toISOString(),
    quota: {
      remaining: remaining ? parseInt(remaining, 10) : null,
      used: used ? parseInt(used, 10) : null,
    },
    ...normalized,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const now = Date.now();
  const cache = globalThis.__PGA_ODDS_CACHE;
  const ttl = ttlForNow(new Date(now));

  if (cache && cache.payload && now - cache.fetchedAtMs < ttl) {
    res.setHeader('cache-status', 'hit');
    res.setHeader('cache-age-ms', String(now - cache.fetchedAtMs));
    res.setHeader('cache-ttl-ms', String(ttl));
    return res.status(200).json(cache.payload);
  }

  try {
    const payload = await fetchUpstream();
    globalThis.__PGA_ODDS_CACHE = { fetchedAtMs: now, payload };
    res.setHeader('cache-status', 'miss');
    res.setHeader('cache-ttl-ms', String(ttl));
    return res.status(200).json(payload);
  } catch (err) {
    // On upstream failure, serve stale cache if available — better than nothing.
    if (cache && cache.payload) {
      res.setHeader('cache-status', 'stale');
      res.setHeader('cache-age-ms', String(now - cache.fetchedAtMs));
      res.setHeader('x-upstream-error', String(err.message).slice(0, 200));
      return res.status(200).json(cache.payload);
    }
    return res.status(502).json({ error: 'Upstream fetch failed', detail: String(err.message) });
  }
}
