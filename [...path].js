'use strict';
/* CleanConnect API for Vercel: one catch-all function. Data lives in Postgres (Neon) in a tiny key-value table.
   Same rules as the local server.js. Roles are enforced here, not in the browser. */
const crypto = require('crypto');
const STAGES = ['Pending Review', 'Assigned to Area Team', 'Cleanup In Progress', 'Cleanup Completed', 'Feedback Received'];
const CATS = ['Household garbage', 'Roadside dumping', 'Overflowing public bins', 'Market waste', 'Construction debris', 'Missed garbage collection', 'Other'];
const WARDS = ['Riverside', 'Old Market', 'Hillview'];
const TEAMS = WARDS.map((w, i) => ({ id: 't' + (i + 1), ward: w, name: w + ' Sanitation Team (sample)' }));
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (c, m) => { throw new HttpError(c, m); };

/* ---------- storage: Neon Postgres key-value table (swappable for tests) ---------- */
let store = null;
function getStore() {
  if (store) return store;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) fail(500, 'Database is not connected. In Vercel, open Storage and connect a Neon database, then redeploy.');
  const sql = require('@neondatabase/serverless').neon(url);
  let ready;
  const init = () => ready || (ready = sql`CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value text NOT NULL)`);
  store = {
    async read(keys) { await init(); const rows = await sql`SELECT key, value FROM kv WHERE key = ANY(${keys})`; return Object.fromEntries(rows.map(r => [r.key, r.value])); },
    async write(key, value) { await init(); await sql`INSERT INTO kv (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`; },
    async create(key, value) { // insert only if absent; returns whatever is stored (safe when two cold starts race)
      await init(); await sql`INSERT INTO kv (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO NOTHING`;
      return (await sql`SELECT value FROM kv WHERE key = ${key}`)[0].value; }
  };
  return store;
}
function mkUser(name, email, pw, role, teamId = null) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: crypto.randomUUID(), name, email: email.toLowerCase(), salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex'), role, teamId };
}
async function loadDb() {
  const s = getStore(), raw = await s.read(['users', 'reports', 'secret']);
  const db = { secret: raw.secret || await s.create('secret', crypto.randomBytes(32).toString('hex')), reports: raw.reports ? JSON.parse(raw.reports) : [], users: raw.users ? JSON.parse(raw.users) : null };
  if (!db.users) { // first run: seed admin + team accounts from environment variables
    const a = process.env.ADMIN_PASSWORD, t = process.env.TEAM_PASSWORD;
    if (a && t && a.length >= 8 && t.length >= 8) {
      db.users = JSON.parse(await s.create('users', JSON.stringify([mkUser('Administrator', 'admin@demo.local', a, 'admin'), ...TEAMS.map(x => mkUser(x.name, x.id + '@demo.local', t, 'team', x.id))])));
    } else db.users = []; // staff accounts appear once both variables are set (8+ characters) and the site is redeployed
  }
  return db;
}
const persist = (db, ...keys) => Promise.all(keys.map(k => getStore().write(k, JSON.stringify(db[k]))));

/* ---------- auth ---------- */
function checkPw(u, pw) {
  const a = Buffer.from(crypto.scryptSync(pw, u.salt, 32).toString('hex')), b = Buffer.from(u.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (p, db) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', db.secret).update(b).digest('base64url'); };
function verify(tok, db) {
  const [b, s] = String(tok || '').split('.');
  if (!b || !s) return null;
  const ok = crypto.createHmac('sha256', db.secret).update(b).digest('base64url');
  if (s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? db.users.find(u => u.id === p.id) || null : null; } catch (e) { return null; }
}
const tries = {}; // per-instance failed-login counter (best effort on serverless)
const recentFails = ip => (tries[ip] = (tries[ip] || []).filter(x => Date.now() - x < 9e5));

/* ---------- helpers ---------- */
const team = id => TEAMS.find(t => t.id === id);
function str(v, min, max, name) { v = typeof v === 'string' ? v.trim() : ''; if (v.length < min || v.length > max) fail(400, name + ' must be ' + min + '-' + max + ' characters.'); return v; }
async function body(req) {
  if (req.body !== undefined && req.body !== null) { // Vercel may have parsed it already
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)); } catch (e) { fail(400, 'Invalid JSON.'); }
  }
  const c = []; let n = 0;
  for await (const d of req) { n += d.length; if (n > 4e6) fail(413, 'Request too large.'); c.push(d); }
  try { return c.length ? JSON.parse(Buffer.concat(c)) : {}; } catch (e) { fail(400, 'Invalid JSON.'); }
}
async function putPhoto(data) { // stores the image in the database; returns its public path
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) fail(400, 'Photo must be a JPG, PNG or WebP data URL.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5e6) fail(400, 'Photo must be under 1.5 MB.');
  const magic = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!magic.every((b, i) => buf[i] === b)) fail(400, 'Photo content does not match its type.');
  const name = crypto.randomBytes(16).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  await getStore().write('photo:' + name, m[2]); return '/api/photo/' + name;
}
function suggestPriority(cat, desc) {
  if (/hospital|school|drain|medical|hazard|smell|fire|broken glass/i.test(desc)) return 'High';
  return ['Market waste', 'Overflowing public bins', 'Missed garbage collection', 'Construction debris'].includes(cat) ? 'Medium' : 'Low';
}
const placeKey = r => r.ward + '|' + r.location.toLowerCase().trim();
function view(r, u, db) { // public shape: never exposes owner id or emails
  const d = db.reports.find(o => o.id !== r.id && o.stage < 3 && o.created < r.created && placeKey(o) === placeKey(r) && o.category === r.category);
  const { owner, supports, ...rest } = r;
  return { ...rest, stageName: STAGES[r.stage], supportCount: supports.length, supportedByMe: !!u && supports.includes(u.id), mine: !!u && owner === u.id, possibleDuplicateOf: d ? d.id : null };
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function stats(rows) {
  const done = rows.filter(r => r.stage >= 3), fb = rows.filter(r => r.feedback);
  return { total: rows.length, pending: rows.length - done.length, completed: done.length, residentConfirmed: fb.length,
    avgResolutionDays: avg(done.map(r => (r.completedAt - r.created) / 864e5)), resolutionRate: rows.length ? done.length / rows.length * 100 : 0,
    satisfaction: avg(fb.map(r => r.feedback.overall)), quality: avg(fb.map(r => r.feedback.quality)), timeliness: avg(fb.map(r => r.feedback.time)), feedbackRate: done.length ? fb.length / done.length * 100 : 0 };
}
function log(r, to, u, note) { r.timeline.push({ from: r.stage, to, at: Date.now(), by: u.role + ':' + u.name, note: note || '' }); r.stage = to; if (to === 3) r.completedAt = Date.now(); }
const need = (u, ...roles) => { if (!u) fail(401, 'Sign in required.'); if (!roles.includes(u.role)) fail(403, 'Your role cannot do this.'); };
const canWork = (u, r) => u.role === 'admin' || (u.role === 'team' && u.teamId === r.teamId);

/* ---------- routes ---------- */
async function route(req, url, db, u) {
  const m = req.method, p = url.pathname, q = url.searchParams;
  const getReport = id => db.reports.find(r => r.id === id) || fail(404, 'Report not found.');
  let x;
  if (m === 'POST' && p === '/api/register') {
    const b = await body(req), email = str(b.email, 5, 100, 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email.');
    if (db.users.some(o => o.email === email)) fail(409, 'That email is already registered.');
    const nu = mkUser(str(b.name, 2, 60, 'Name'), email, str(b.password, 8, 100, 'Password'), 'resident'); db.users.push(nu); await persist(db, 'users');
    return { token: sign({ id: nu.id, exp: Date.now() + 6048e5 }, db), user: { name: nu.name, role: nu.role } };
  }
  if (m === 'POST' && p === '/api/login') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    if (recentFails(ip).length >= 10) fail(429, 'Too many failed attempts. Try again in 15 minutes.');
    const b = await body(req), lu = db.users.find(o => o.email === String(b.email || '').toLowerCase());
    if (!lu || !checkPw(lu, String(b.password || ''))) { tries[ip].push(Date.now()); fail(401, 'Wrong email or password.'); }
    return { token: sign({ id: lu.id, exp: Date.now() + 6048e5 }, db), user: { name: lu.name, role: lu.role, teamId: lu.teamId } };
  }
  if (m === 'GET' && p === '/api/me') { need(u, 'resident', 'team', 'admin'); return { name: u.name, role: u.role, teamId: u.teamId }; }
  if (m === 'GET' && p === '/api/meta') return { stages: STAGES, categories: CATS, wards: WARDS, teams: TEAMS, staffAccountsReady: db.users.some(z => z.role === 'admin') };
  if (m === 'GET' && p === '/api/reports') {
    const s = (q.get('q') || '').toLowerCase();
    const rows = db.reports.filter(r => (!s || (r.title + r.description + r.location).toLowerCase().includes(s)) && (!q.get('ward') || r.ward === q.get('ward')) &&
      (!q.get('category') || r.category === q.get('category')) && (!q.get('status') || r.stage === +q.get('status')));
    rows.sort((a, b) => q.get('sort') === 'old' ? a.created - b.created : b.created - a.created);
    return rows.map(r => view(r, u, db));
  }
  if (m === 'POST' && p === '/api/reports') {
    need(u, 'resident'); const b = await body(req);
    if (b.consent !== true) fail(400, 'Consent is required.');
    const category = CATS.includes(b.category) ? b.category : fail(400, 'Choose a valid category.'), ward = WARDS.includes(b.ward) ? b.ward : fail(400, 'Choose a valid ward.');
    const coords = String(b.coords || '').trim(); if (coords && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(coords)) fail(400, 'Coordinates must be "lat, lng".');
    const title = str(b.title, 5, 80, 'Title'), description = str(b.description, 10, 500, 'Description'), location = str(b.location, 2, 80, 'Location');
    const photo = await putPhoto(b.photo), t = TEAMS.find(z => z.ward === ward);
    const r = { id: 'CC-' + (Math.max(1000, ...db.reports.map(z => +z.id.slice(3) || 0)) + 1), title, category, description, location, ward, coords, photo, afterPhoto: null, owner: u.id,
      created: Date.now(), stage: 0, priority: suggestPriority(category, description), teamId: t ? t.id : null, supports: [], notes: [], completedAt: null, feedback: null,
      timeline: [{ from: null, to: 0, at: Date.now(), by: 'resident:' + u.name, note: '' }] };
    db.reports.unshift(r); if (t) log(r, 1, { role: 'system', name: 'auto' }, 'Auto-assigned by ward'); await persist(db, 'reports'); return view(r, u, db);
  }
  if ((x = /^\/api\/reports\/(CC-\d+)(\/\w+)?$/.exec(p))) {
    const r = getReport(x[1]), sub = x[2];
    if (m === 'GET' && !sub) return view(r, u, db);
    if (m === 'POST' && sub === '/support') { need(u, 'resident'); if (r.supports.includes(u.id)) fail(409, 'You already supported this report.'); r.supports.push(u.id); await persist(db, 'reports'); return view(r, u, db); }
    if (m === 'POST' && sub === '/status') {
      need(u, 'team', 'admin'); if (!canWork(u, r)) fail(403, 'This report belongs to another team.');
      const b = await body(req), to = +b.to; if (!((r.stage === 1 && to === 2) || (r.stage === 2 && to === 3))) fail(409, 'Invalid status change from ' + STAGES[r.stage] + '.');
      if (b.note) r.notes.push({ text: str(b.note, 1, 300, 'Note'), at: Date.now(), by: u.name });
      if (to === 3 && b.afterPhoto) r.afterPhoto = await putPhoto(b.afterPhoto);
      log(r, to, u, b.note ? 'See work note' : ''); await persist(db, 'reports'); return view(r, u, db);
    }
    if (m === 'PATCH' && !sub) {
      need(u, 'admin'); const b = await body(req);
      if (b.priority !== undefined) r.priority = ['Low', 'Medium', 'High'].includes(b.priority) ? b.priority : fail(400, 'Invalid priority.');
      if (b.teamId !== undefined) { team(b.teamId) || fail(400, 'Unknown team.'); r.teamId = b.teamId; if (r.stage === 0) log(r, 1, u, 'Assigned by admin'); }
      await persist(db, 'reports'); return view(r, u, db);
    }
    if (m === 'POST' && sub === '/feedback') {
      need(u, 'resident'); if (r.owner !== u.id) fail(403, 'Only the original reporter can rate this cleanup.');
      if (r.feedback) fail(409, 'Feedback was already submitted.'); if (r.stage !== 3) fail(409, 'Feedback opens after the team marks the cleanup completed.');
      const b = await body(req), n = v => Number.isInteger(v) && v >= 1 && v <= 5 ? v : fail(400, 'Ratings must be 1 to 5.');
      r.feedback = { overall: n(b.overall), time: n(b.time), quality: n(b.quality), text: b.text ? str(b.text, 1, 300, 'Comment') : '' }; log(r, 4, u, 'Feedback submitted'); await persist(db, 'reports'); return view(r, u, db);
    }
  }
  if (m === 'GET' && p === '/api/stats') return { areas: WARDS.map(w => ({ ward: w, ...stats(db.reports.filter(r => r.ward === w)) })), overall: stats(db.reports) };
  fail(404, 'Unknown endpoint.');
}

/* ---------- Vercel entry point ---------- */
async function handler(req, res) {
  const send = (c, o, t = 'application/json', extra = {}) => {
    res.statusCode = c; res.setHeader('Content-Type', t); res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(t === 'application/json' ? JSON.stringify(o) : o);
  };
  try {
    const url = new URL(req.url, 'http://x');
    const ph = /^\/api\/photo\/([a-f0-9]{32})\.(jpg|png|webp)$/.exec(url.pathname);
    if (ph) { // photos are served from the database
      const v = (await getStore().read(['photo:' + ph[1] + '.' + ph[2]]))['photo:' + ph[1] + '.' + ph[2]];
      if (!v) fail(404, 'Photo not found.');
      return send(200, Buffer.from(v, 'base64'), MIME[ph[2]], { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    const db = await loadDb(), u = verify((req.headers.authorization || '').replace(/^Bearer /, ''), db);
    send(200, await route(req, url, db, u), 'application/json', { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e instanceof HttpError) return send(e.code, { error: e.message });
    console.error(e); send(500, { error: 'Server error.' });
  }
}
module.exports = handler;
module.exports.useStore = s => { store = s; }; // lets tests plug in a fake database
