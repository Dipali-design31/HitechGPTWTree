// Hitech GPTW Tree API: one serverless function for Vercel, data in Neon Postgres.
// GET  /api/tree?v=N           -> public tree (only sends data when something changed)
// POST /api/tree {action:'add'} -> a colleague adds a hand
// POST /api/tree {action, password, ...} -> admin actions (password checked here, never in the page)
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let sql = DB_URL ? neon(DB_URL) : null;
export function _setSql(fn) { sql = fn; ready = null; } // used by local tests only

const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'Excellence@1231';
const HEX = /^#[0-9a-fA-F]{6}$/;
const nameKey = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, '').replace(/\s+/g, ' ').trim();
const clean = (s, n) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS gptw_posts (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, word TEXT NOT NULL, color TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`CREATE TABLE IF NOT EXISTS gptw_settings (k TEXT PRIMARY KEY, v JSONB NOT NULL)`;
      await sql`INSERT INTO gptw_settings (k, v) VALUES ('ver', '1'::jsonb), ('config', '{}'::jsonb) ON CONFLICT (k) DO NOTHING`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
async function getSetting(k) { const r = await sql`SELECT v FROM gptw_settings WHERE k = ${k}`; return r[0] ? r[0].v : null; }
async function setSetting(k, v) { await sql`INSERT INTO gptw_settings (k, v) VALUES (${k}, ${JSON.stringify(v)}::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; }
async function bump() { const r = await sql`UPDATE gptw_settings SET v = to_jsonb((v #>> '{}')::int + 1) WHERE k = 'ver' RETURNING v`; return Number(r[0].v); }
async function getConfig() { return { maxWord: 20, open: true, moderate: false, onePerPerson: true, ...((await getSetting('config')) || {}) }; }

// ---- password ----
const fails = new Map(); // per-instance brute-force brake
function ipOf(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x'; }
function sameText(a, b) { const h = (s) => crypto.createHash('sha256').update(String(s)).digest(); return crypto.timingSafeEqual(h(a), h(b)); }
async function checkPassword(pw) {
  const rec = await getSetting('pw');
  if (!rec) return sameText(pw || '', DEFAULT_PASSWORD);
  const hash = crypto.scryptSync(String(pw || ''), rec.salt, 64).toString('hex');
  return sameText(hash, rec.hash);
}

// ---- config sanitising ----
const STR = { title: 120, subtitle: 200, question: 160, trunkLabel: 24, fruitLabel: 10, cta: 40, submit: 60, thanks: 200, footLine: 120, footTag: 40 };
function sanitizeConfig(c) {
  const o = {};
  if (!c || typeof c !== 'object') return o;
  for (const [k, n] of Object.entries(STR)) if (typeof c[k] === 'string') o[k] = clean(c[k], n);
  if (typeof c.shareText === 'string') o.shareText = c.shareText.replace(/[\u0000-\u0009\u000B-\u001F\u007F<>]/g, '').trim().slice(0, 1000);
  for (const k of ['open', 'moderate', 'showBadge', 'onePerPerson']) if (typeof c[k] === 'boolean') o[k] = c[k];
  if (c.scene === 'day' || c.scene === 'dusk') o.scene = c.scene;
  if (Number.isFinite(+c.maxWord)) o.maxWord = Math.max(5, Math.min(40, Math.round(+c.maxWord)));
  if (Array.isArray(c.suggestions)) o.suggestions = c.suggestions.map((s) => clean(s, 24)).filter(Boolean).slice(0, 30);
  if (Array.isArray(c.palette)) {
    const p = c.palette.filter((x) => x && HEX.test(x.c || '')).slice(0, 16).map((x) => ({ n: clean(x.n, 30) || x.c, c: x.c }));
    if (p.length) o.palette = p;
  }
  if (Array.isArray(c.fruits)) o.fruits = c.fruits.filter((f) => Array.isArray(f) && Number.isFinite(+f[0]) && Number.isFinite(+f[1])).slice(0, 400)
    .map((f) => [Math.round(Math.max(0, Math.min(1600, +f[0]))), Math.round(Math.max(0, Math.min(1200, +f[1])))]);
  for (const k of ['logoLeft', 'logoRight']) {
    if (c[k] === '') o[k] = '';
    else if (typeof c[k] === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c[k]) && c[k].length <= 300000) o[k] = c[k];
  }
  return o;
}

// ---- handlers ----
const adds = new Map();
async function addPost(b, res, req, asAdmin) {
  const cfg = await getConfig();
  if (!asAdmin && cfg.open === false) return res.status(403).json({ error: 'The tree is not taking new hands right now.' });
  if (!asAdmin) {
    const ip = ipOf(req), now = Date.now(), a = (adds.get(ip) || []).filter((t) => now - t < 600000);
    if (a.length >= 30) return res.status(429).json({ error: 'Too many hands from this connection. Try again in a few minutes.' });
    a.push(now); adds.set(ip, a);
  }
  const name = clean(b.name, 60), word = clean(b.word, asAdmin ? 40 : cfg.maxWord), color = String(b.color || '');
  if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!word) return res.status(400).json({ error: 'Add one word.' });
  if (!HEX.test(color)) return res.status(400).json({ error: 'Choose a hand colour.' });
  // One hand per person: the same full name (ignoring case, spaces and punctuation) can only be added once.
  if (!asAdmin && cfg.onePerPerson !== false) {
    const key = nameKey(name), rows = await sql`SELECT id, name, status FROM gptw_posts`;
    const ex = rows.find((r) => nameKey(r.name) === key);
    if (ex) return res.status(409).json({ error: `${ex.name} already has a hand on the tree. Each person can add one hand. To change your word, please contact HR.`, already: true, existingId: ex.status === 'approved' ? ex.id : null });
  }
  const dup = await sql`SELECT id, status FROM gptw_posts WHERE lower(name) = lower(${name}) AND lower(word) = lower(${word}) LIMIT 1`;
  if (dup.length) return asAdmin ? null : res.json({ ok: true, id: dup[0].id, pending: dup[0].status !== 'approved', duplicate: true });
  const status = asAdmin || !cfg.moderate ? 'approved' : 'pending';
  const r = await sql`INSERT INTO gptw_posts (name, word, color, status) VALUES (${name}, ${word}, ${color}, ${status}) RETURNING id`;
  if (status === 'approved') await bump();
  return asAdmin ? null : res.json({ ok: true, id: r[0].id, pending: status !== 'approved' });
}
async function adminState(res) {
  const [v, config, rows] = await Promise.all([
    getSetting('ver'), getSetting('config'),
    sql`SELECT id, name, word, color, status, created_at FROM gptw_posts ORDER BY id`
  ]);
  return res.json({ ok: true, v: Number(v), config: config || {}, posts: rows.map((r) => ({ id: r.id, name: r.name, word: r.word, color: r.color, status: r.status, created: new Date(r.created_at).toISOString() })) });
}
const ids = (a) => (Array.isArray(a) ? a : []).map(Number).filter(Number.isInteger).slice(0, 5000);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sql) return res.status(500).json({ error: 'The database is not connected yet. In Vercel, open Storage, add a Neon Postgres database to this project, then redeploy.' });
  try {
    await init();
    if (req.method === 'GET') {
      const ver = Number(await getSetting('ver')) || 1;
      if (Number(req.query?.v) === ver) return res.json({ v: ver, same: true });
      const [config, rows] = await Promise.all([getSetting('config'), sql`SELECT id, name, word, color FROM gptw_posts WHERE status = 'approved' ORDER BY id`]);
      return res.json({ v: ver, config: config || {}, posts: rows.map((r) => [r.id, r.name, r.word, r.color]) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    if (b.action === 'add') return addPost(b, res, req, false);

    // ---- admin ----
    const ip = ipOf(req), f = fails.get(ip);
    if (f && f.n >= 6 && Date.now() - f.t < 300000) return res.status(429).json({ error: 'Too many wrong passwords. Wait 5 minutes and try again.', auth: false });
    if (!(await checkPassword(b.password))) {
      fails.set(ip, { n: (f && Date.now() - f.t < 300000 ? f.n : 0) + 1, t: Date.now() });
      return res.status(401).json({ error: 'That password is not correct.', auth: false });
    }
    fails.delete(ip);
    switch (b.action) {
      case 'login': case 'list': break;
      case 'delete': { const list = ids(b.ids); if (list.length) { await sql`DELETE FROM gptw_posts WHERE id = ANY(${list}::int[])`; await bump(); } break; }
      case 'approve': { const list = ids(b.ids); if (list.length) { await sql`UPDATE gptw_posts SET status = 'approved' WHERE id = ANY(${list}::int[])`; await bump(); } break; }
      case 'update': {
        const id = Number(b.id), name = clean(b.name, 60), word = clean(b.word, 40);
        if (!Number.isInteger(id) || name.length < 2 || !word) return res.status(400).json({ error: 'Name and word cannot be empty.' });
        const color = HEX.test(b.color || '') ? b.color : null, status = b.status === 'pending' || b.status === 'approved' ? b.status : null;
        const r = await sql`UPDATE gptw_posts SET name = ${name}, word = ${word}, color = COALESCE(${color}, color), status = COALESCE(${status}, status) WHERE id = ${id} RETURNING id`;
        if (!r.length) return res.status(404).json({ error: 'That entry no longer exists.' });
        await bump(); break;
      }
      case 'adminAdd': { const out = await addPost(b, res, req, true); if (out !== null) return out; await bump(); break; }
      case 'setConfig': { await setSetting('config', sanitizeConfig(b.config)); await bump(); break; }
      case 'changePassword': {
        const np = String(b.newPassword || '');
        if (np.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the new password.' });
        const salt = crypto.randomBytes(16).toString('hex');
        await setSetting('pw', { salt, hash: crypto.scryptSync(np, salt, 64).toString('hex') });
        break;
      }
      case 'deleteAll': {
        if (b.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });
        await sql`DELETE FROM gptw_posts`; await bump(); break;
      }
      default: return res.status(400).json({ error: 'Unknown action.' });
    }
    return adminState(res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
  }
}
