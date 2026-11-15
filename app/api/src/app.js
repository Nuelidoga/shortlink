const express = require('express');
const crypto = require('node:crypto');
const promClient = require('prom-client');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 7;
const CODE_PATTERN = /^[A-Za-z0-9]{7}$/;
const MAX_URL_LENGTH = 2048;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

function isValidUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function log(level, msg, extra = {}) {
  // JSON logs are easy to query in Azure Log Analytics.
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

const INTERNAL_PATHS = new Set(['/health', '/ready', '/metrics']);

// Prometheus metrics: request counts and durations, plus Node.js process metrics.
function createMetrics() {
  const register = new promClient.Registry();
  promClient.collectDefaultMetrics({ register });

  const requests = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
  });

  const duration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  return { register, requests, duration };
}

function createApp(db) {
  const app = express();
  const metrics = createMetrics();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '10kb' }));

  // Request logging + metrics
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (INTERNAL_PATHS.has(req.path)) return;
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // Use the route pattern (e.g. "/:code"), not the real path, to keep metric labels small.
      const labels = {
        method: req.method,
        route: req.route ? req.route.path : 'unmatched',
        status: String(res.statusCode),
      };
      metrics.requests.inc(labels);
      metrics.duration.observe(labels, seconds);
      log('info', 'request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
      });
    });
    next();
  });

  // Scraped by Prometheus inside the cluster (blocked at the public frontend).
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  });

  // Liveness: is the process running?
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: can we reach the database?
  app.get('/ready', async (req, res) => {
    try {
      await db.ping();
      res.json({ status: 'ready' });
    } catch (err) {
      log('error', 'readiness check failed', { error: err.message });
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Create a short link
  app.post('/api/links', async (req, res) => {
    const url = req.body?.url;
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Please provide a valid http(s) URL.' });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        await db.insertLink(code, url);
        return res.status(201).json({ code, originalUrl: url });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') continue; // code collision, try again
        throw err;
      }
    }
    return res.status(500).json({ error: 'Could not generate a unique code. Please try again.' });
  });

  // List recent links
  app.get('/api/links', async (req, res) => {
    const links = await db.listLinks(50);
    res.json(links);
  });

  // Redirect a short code to the original URL
  app.get('/:code', async (req, res) => {
    const { code } = req.params;
    if (!CODE_PATTERN.test(code)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const link = await db.findByCode(code);
    if (!link) {
      return res.status(404).json({ error: 'Short link not found' });
    }
    await db.incrementClicks(code);
    return res.redirect(302, link.original_url);
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) {
      log('error', 'unhandled error', { error: err.message, stack: err.stack });
    }
    res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Bad request' });
  });

  return app;
}

module.exports = { createApp, isValidUrl, generateCode, log };
