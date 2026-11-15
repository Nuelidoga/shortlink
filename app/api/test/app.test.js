const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp, isValidUrl, generateCode } = require('../src/app');

// In-memory fake database, so tests run in CI without MySQL.
function fakeDb({ pingFails = false } = {}) {
  const links = new Map();
  return {
    links,
    async ping() {
      if (pingFails) throw new Error('db down');
    },
    async insertLink(code, url) {
      if (links.has(code)) {
        const err = new Error('duplicate');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      links.set(code, { code, original_url: url, clicks: 0 });
    },
    async findByCode(code) {
      return links.get(code) || null;
    },
    async incrementClicks(code) {
      links.get(code).clicks += 1;
    },
    async listLinks() {
      return [...links.values()].map((l) => ({ code: l.code, originalUrl: l.original_url, clicks: l.clicks }));
    },
  };
}

test('GET /health returns ok', async () => {
  const res = await request(createApp(fakeDb())).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /ready returns 503 when the database is down', async () => {
  const res = await request(createApp(fakeDb({ pingFails: true }))).get('/ready');
  assert.equal(res.status, 503);
});

test('POST /api/links rejects invalid URLs', async () => {
  const app = createApp(fakeDb());
  for (const url of ['', 'not a url', 'javascript:alert(1)', 'ftp://example.com']) {
    const res = await request(app).post('/api/links').send({ url });
    assert.equal(res.status, 400, `expected 400 for "${url}"`);
  }
});

test('POST /api/links rejects malformed JSON', async () => {
  const res = await request(createApp(fakeDb()))
    .post('/api/links')
    .set('Content-Type', 'application/json')
    .send('{bad json');
  assert.equal(res.status, 400);
});

test('creates a link, redirects, and counts the click', async () => {
  const db = fakeDb();
  const app = createApp(db);

  const created = await request(app).post('/api/links').send({ url: 'https://azure.microsoft.com' });
  assert.equal(created.status, 201);
  assert.match(created.body.code, /^[A-Za-z0-9]{7}$/);

  const redirect = await request(app).get(`/${created.body.code}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, 'https://azure.microsoft.com');
  assert.equal(db.links.get(created.body.code).clicks, 1);

  const list = await request(app).get('/api/links');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test('unknown short code returns 404', async () => {
  const res = await request(createApp(fakeDb())).get('/abcdefg');
  assert.equal(res.status, 404);
});

test('GET /metrics exposes Prometheus metrics', async () => {
  const app = createApp(fakeDb());
  await request(app).get('/api/links');
  const res = await request(app).get('/metrics');
  assert.equal(res.status, 200);
  assert.match(res.text, /http_requests_total\{method="GET",route="\/api\/links",status="200"\} 1/);
});

test('helpers behave correctly', () => {
  assert.equal(isValidUrl('https://example.com/path?q=1'), true);
  assert.equal(isValidUrl('http://localhost:8080'), true);
  assert.equal(isValidUrl('mailto:someone@example.com'), false);
  assert.equal(isValidUrl('https://' + 'a'.repeat(3000)), false);
  assert.match(generateCode(), /^[A-Za-z0-9]{7}$/);
});
