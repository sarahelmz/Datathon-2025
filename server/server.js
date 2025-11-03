require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3001;
const DATA_PATH = path.join(__dirname, '..', 'companies.json');
const AWS_ENDPOINT = 'https://hvitsw46i3.execute-api.us-west-2.amazonaws.com/Prod/finance-qa';
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;
const ALPHA_BASE_URL = 'https://www.alphavantage.co/query';

const raw = fs.readFileSync(DATA_PATH, 'utf8');
let companies;

try {
  companies = JSON.parse(raw);
} catch (error) {
  console.error('Failed to parse companies.json:', error.message);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const getPopularity = (value) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalize = (value) => value?.toString().toLowerCase() ?? '';

app.get('/search', (req, res) => {
  const query = normalize(req.query.q).trim();

  if (!query) {
    res.json({ results: [] });
    return;
  }

  const prefixMatches = [];
  const substringMatches = [];

  for (const company of companies) {
    const name = company.name ?? '';
    const ticker = company.ticker ?? '';
    const popularity = getPopularity(company.popularity);
    const nameLower = normalize(name);
    const tickerLower = normalize(ticker);

    if (!nameLower && !tickerLower) continue;

    const fields = [nameLower, tickerLower];
    const isPrefix = fields.some((field) => field.startsWith(query));
    const isSubstring = !isPrefix && fields.some((field) => field.includes(query));

    if (isPrefix) {
      prefixMatches.push({ name, ticker, popularity });
    } else if (isSubstring) {
      substringMatches.push({ name, ticker, popularity });
    }
  }

  const popularitySort = (a, b) => b.popularity - a.popularity;
  prefixMatches.sort(popularitySort);
  substringMatches.sort(popularitySort);

  const results = prefixMatches.concat(substringMatches).slice(0, 5);
  res.json({ results });
});

const alphaRequest = async (params) => {
  const url = new URL(ALPHA_BASE_URL);
  const searchParams = new URLSearchParams({ ...params, apikey: ALPHA_VANTAGE_KEY });
  url.search = searchParams.toString();

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`Alpha Vantage request failed with status ${response.status}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }

  const data = await response.json();
  if (data.Note) {
    const error = new Error(data.Note);
    error.status = 429;
    error.body = data.Note;
    throw error;
  }
  if (data['Error Message']) {
    const error = new Error(data['Error Message']);
    error.status = 404;
    error.body = data['Error Message'];
    throw error;
  }
  return data;
};

const parseMarketCap = (value) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseDailySeries = (payload) => {
  const series = payload?.['Time Series (Daily)'];
  if (!series || typeof series !== 'object') return null;

  const dates = Object.keys(series).sort();
  if (!dates.length) return null;

  const history = dates.map((date) => {
    const entry = series[date] || {};
    const close = Number.parseFloat(entry['4. close']);
    if (!Number.isFinite(close)) return null;
    return {
      date: new Date(date).toISOString(),
      close,
    };
  }).filter(Boolean);

  if (!history.length) return null;

  const latest = history[history.length - 1];
  const previous = history[history.length - 2] || null;

  return {
    history,
    latest,
    previous,
  };
};

const sanitizeSymbols = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const clean = [];
  const seen = new Set();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const symbol = entry.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    clean.push(symbol);
    seen.add(symbol);
  }
  return clean;
};

const cache = new Map();
const setCache = (key, data, ttlMs) => {
  cache.set(key, { data, expires: Date.now() + ttlMs });
};
const getCache = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

const OVERVIEW_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MESSAGE =
  'La limite de requêtes Alpha Vantage a été atteinte. Réessayez dans quelques instants.';

const SERIES_TTL_MS = 2 * 60 * 1000; // 2 minutes

const parseIntradaySeries = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const [seriesKey] =
    Object.keys(payload).filter((key) => key.startsWith('Time Series')) || [];
  const series = payload[seriesKey];
  if (!series || typeof series !== 'object') return null;

  const timestamps = Object.keys(series).sort();
  if (!timestamps.length) return null;

  const history = timestamps
    .map((stamp) => {
      const entry = series[stamp] || {};
      const close = Number.parseFloat(
        entry['4. close'] ??
          entry['4. Close'] ??
          entry['4.Close'] ??
          entry.close ??
          entry.Close
      );
      if (!Number.isFinite(close)) return null;
      return {
        date: new Date(stamp).toISOString(),
        close,
      };
    })
    .filter(Boolean);

  if (!history.length) return null;
  const latest = history[history.length - 1];
  const previous = history[history.length - 2] || null;
  return {
    history,
    latest,
    previous,
  };
};

const fetchTimeSeries = async (symbol) => {
  const cacheKey = `series:${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const attemptSeries = async (params, parser, ttl = SERIES_TTL_MS) => {
    try {
      const payload = await alphaRequest(params);
      const parsed = parser(payload);
      if (parsed) {
        setCache(cacheKey, parsed, ttl);
        return parsed;
      }
    } catch (error) {
      if (error.status === 429) {
        const rateError = new Error(RATE_LIMIT_MESSAGE);
        rateError.status = 429;
        throw rateError;
      }
      throw error;
    }
    return null;
  };

  try {
    const daily = await attemptSeries(
      { function: 'TIME_SERIES_DAILY', symbol, outputsize: 'compact' },
      parseDailySeries
    );
    if (daily) return daily;

    const adjusted = await attemptSeries(
      { function: 'TIME_SERIES_DAILY_ADJUSTED', symbol, outputsize: 'compact' },
      parseDailySeries
    );
    if (adjusted) return adjusted;

    const intraday = await attemptSeries(
      {
        function: 'TIME_SERIES_INTRADAY',
        symbol,
        interval: '60min',
        outputsize: 'compact',
      },
      parseIntradaySeries,
      SERIES_TTL_MS / 2
    );
    if (intraday) return intraday;

    const error = new Error(
      `Aucune série quotidienne disponible pour ${symbol}.`
    );
    error.status = 404;
    throw error;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
};

const fetchDailySeries = async (symbol) => {
  try {
    return await fetchTimeSeries(symbol);
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`Aucune série de prix exploitable trouvée pour ${symbol}.`);
    }
    throw error;
  }
};

const fetchOverview = async (symbol) => {
  const cacheKey = `overview:${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const overviewPayload = await alphaRequest({ function: 'OVERVIEW', symbol });
    if (overviewPayload && Object.keys(overviewPayload).length) {
      setCache(cacheKey, overviewPayload, OVERVIEW_TTL_MS);
    }
    return overviewPayload;
  } catch (error) {
    if (cached) return cached;
    if (error.status === 429) {
      const rateError = new Error(RATE_LIMIT_MESSAGE);
      rateError.status = 429;
      throw rateError;
    }
    throw error;
  }
};
app.get('/api/company', async (req, res) => {
  const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol : '';
  const symbol = rawSymbol.trim().toUpperCase();

  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol parameter.' });
    return;
  }

  try {
    const parsed = await fetchDailySeries(symbol);
    const overviewPayload = await fetchOverview(symbol);

    const currency = overviewPayload?.Currency || 'USD';
    const price = parsed.latest?.close ?? null;
    const previousClose = parsed.previous?.close ?? null;
    let changePercent = null;
    if (Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0) {
      changePercent = ((price - previousClose) / previousClose) * 100;
    }

    res.json({
      symbol,
      name: overviewPayload?.Name || overviewPayload?.Symbol || symbol,
      currency,
      marketCap: parseMarketCap(overviewPayload?.MarketCapitalization),
      price,
      previousClose,
      changePercent,
      exchange: overviewPayload?.Exchange || null,
      history: parsed.history.slice(-60),
    });
  } catch (error) {
    console.error(`Error retrieving company data for ${symbol}:`, error);
    const status = error.status && error.status >= 400 ? error.status : 502;
    res.status(status).json({
      error: 'Échec de la récupération des données financières.',
      details: error.body ? String(error.body).slice(0, 500) : error.message,
    });
  }
});

app.get('/api/quotes', async (req, res) => {
  const symbols = sanitizeSymbols(req.query.symbols ?? req.query.symbol ?? req.query.q);

  if (!symbols.length) {
    res.status(400).json({ error: 'Missing symbols parameter.' });
    return;
  }

  try {
    const quotes = [];

    for (const symbol of symbols) {
      try {
        const parsed = await fetchDailySeries(symbol);
        if (!parsed || !parsed.latest) continue;

        const price = parsed.latest.close;
        const previous = parsed.previous?.close ?? null;
        let changePercent = null;
        if (Number.isFinite(price) && Number.isFinite(previous) && previous !== 0) {
          changePercent = ((price - previous) / previous) * 100;
        }

        quotes.push({
          symbol,
          name: symbol,
          currency: 'USD',
          price,
          changePercent,
          marketCap: null,
        });
      } catch (innerError) {
        if (innerError.status === 429) {
          res.status(429).json({
            error: RATE_LIMIT_MESSAGE,
            details: innerError.message,
          });
          return;
        }
        if (innerError.status && innerError.status !== 404) {
          throw innerError;
        }
      }
    }

    res.json({ quotes });
  } catch (error) {
    console.error('Error retrieving quotes:', error);
    const status = error.status && error.status >= 400 ? error.status : 502;
    res.status(status).json({
      error: 'Échec de la récupération des cotations.',
      details: error.body ? String(error.body).slice(0, 500) : error.message,
    });
  }
});

app.post('/tet', async (req, res) => {
  try {
    const upstreamResponse = await fetch(AWS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    const contentType = upstreamResponse.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await upstreamResponse.json().catch(() => null) : await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status || 502;
      if (isJson && payload && typeof payload === 'object') {
        res.status(status).json(payload);
      } else {
        res.status(status).json({
          error: 'Upstream request failed.',
          status,
          details: payload ?? null,
        });
      }
      return;
    }

    if (isJson) {
      res.json(payload ?? {});
    } else {
      res.type('text/plain').send(payload ?? '');
    }
  } catch (error) {
    console.error('Error proxying /tet request:', error);
    res.status(502).json({
      error: 'Failed to reach upstream service.',
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Search server listening on port ${PORT}`);
});
