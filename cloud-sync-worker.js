/**
 * Lan工作台 · 云同步 + 兑换码核销 Worker（Cloudflare Workers + KV）
 *
 * 功能：
 * 1. 用户体系：getsalt / register / login / profile
 *    密码由前端 PBKDF2（SHA-256, 默认 20 万次迭代）派生，服务端只存 salt+hash 并比对，不落明文
 *    登录/注册成功签发 session token（30 天有效），云端读写必须携带 token
 * 2. 云同步：put/get（AES-GCM 加密备份，按用户分 key sync:<username>；无有效登录态一律拒绝）
 * 3. 兑换码核销：code_activate（一次一码，透传 type/tokens，为 token 包预留）
 * 4. 管理端（X-Admin-Key）：code_issue / code_list / code_stats / user_list / user_delete
 *
 * KV 结构：
 * - sync:<username>       按用户分 key 的加密备份（云端按用户持久持有）
 * - user:<username>       {salt, hash, iterations, createdAt, plan:{proExp, tokenBalance, tokenUsed}}
 * - session:<token>       {user, exp} 登录会话（30 天；删除用户后立即失效）
 * - code:<code>           兑换码记录 {status, months, batch, issuedAt, usedAt, device, type?, tokens?}
 *
 * 环境变量（Secrets）：
 * - ADMIN_KEY  管理密钥（admin 页面与管理 API 共用）
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function ok(body) { return json({ ok: true, ...body }); }
function fail(msg, status = 400) { return json({ ok: false, error: msg }, status); }

function adminOk(env, request) {
  const key = request.headers.get('X-Admin-Key') || '';
  return env.ADMIN_KEY && key === env.ADMIN_KEY;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
function validUsername(u) { return typeof u === 'string' && USERNAME_RE.test(u); }
// 防枚举用的固定伪盐（不存在的用户也返回同样的盐）
const FAKE_SALT = 'ZGF0YWJhc2Vfbm90X2ZvdW5kX3NhbHQ6Ojo6Ojo6Ojo=';
const EMPTY_PLAN = { proExp: 0, tokenBalance: 0, tokenUsed: 0 };
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 登录会话 30 天

// 签发登录会话（注册/登录成功后调用）
async function issueSession(env, user) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  await env.SYNC_KV.put('session:' + token, JSON.stringify({ user, exp: Date.now() + SESSION_TTL }));
  return token;
}
// 校验 token → 返回用户名；无效/过期/用户已删除 → null
async function authByToken(env, token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const raw = await env.SYNC_KV.get('session:' + token);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s.exp || s.exp < Date.now()) return null;
    if (!validUsername(s.user)) return null;
    const userRaw = await env.SYNC_KV.get('user:' + s.user);
    if (!userRaw) return null; // 用户已删除 → 会话立即失效
    return s.user;
  } catch (e) { return null; }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail('method not allowed', 405);
    try {
      const body = await request.json();
      const action = body.action || '';

      // ==================== 用户体系 ====================
      if (action === 'getsalt') {
        const u = String(body.username || '').trim();
        if (!validUsername(u)) return fail('invalid username');
        const recRaw = await env.SYNC_KV.get('user:' + u);
        const rec = recRaw ? JSON.parse(recRaw) : null;
        return ok({ salt: rec ? rec.salt : FAKE_SALT, iterations: rec ? (rec.iterations || 200000) : 200000 });
      }

      if (action === 'register') {
        const u = String(body.username || '').trim();
        const salt = String(body.salt || '');
        const hash = String(body.hash || '');
        if (!validUsername(u)) return fail('invalid username');
        if (!salt || salt.length < 16 || !hash || hash.length < 32) return fail('bad credentials');
        const key = 'user:' + u;
        const exists = await env.SYNC_KV.get(key);
        if (exists) return fail('username_taken', 409);
        const rec = { salt, hash, iterations: parseInt(body.iterations, 10) || 200000, createdAt: Date.now(), plan: { ...EMPTY_PLAN } };
        await env.SYNC_KV.put(key, JSON.stringify(rec));
        // 注册即登录：直接签发会话
        const token = await issueSession(env, u);
        return ok({ username: u, token });
      }

      if (action === 'login') {
        const u = String(body.username || '').trim();
        const hash = String(body.hash || '');
        if (!validUsername(u)) return fail('invalid username');
        const recRaw = await env.SYNC_KV.get('user:' + u);
        if (!recRaw) return fail('auth_failed', 401);
        const rec = JSON.parse(recRaw);
        if (rec.hash !== hash) return fail('auth_failed', 401); // 前端已用用户盐派生，此处等值比对
        const token = await issueSession(env, u);
        return ok({ username: u, plan: rec.plan || { ...EMPTY_PLAN }, token });
      }

      if (action === 'profile') {
        const u = String(body.username || '').trim();
        if (!validUsername(u)) return fail('invalid username');
        const recRaw = await env.SYNC_KV.get('user:' + u);
        if (!recRaw) return fail('not_found', 404);
        const rec = JSON.parse(recRaw);
        return ok({ username: u, plan: rec.plan || { ...EMPTY_PLAN } });
      }

      // ==================== 云同步（统一登录通道：必须携带有效会话 token） ====================
      if (action === 'put') {
        if (!body.body || typeof body.body !== 'string') return fail('empty body');
        const uid = await authByToken(env, String(body.token || ''));
        if (!uid) return fail('auth_required', 401); // 未登录/会话失效 → 前端引导登录
        const parsed = JSON.parse(body.body);
        const savedAt = parsed && parsed.savedAt ? parsed.savedAt : new Date().toISOString();
        const key = 'sync:' + uid;
        await env.SYNC_KV.put(key, body.body, { metadata: { savedAt } });
        return ok({ savedAt, key });
      }
      if (action === 'get') {
        const uid = await authByToken(env, String(body.token || ''));
        if (!uid) return fail('auth_required', 401);
        const key = 'sync:' + uid;
        const val = await env.SYNC_KV.get(key);
        if (!val) return fail('no backup yet', 404);
        return new Response(val, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ==================== 兑换码核销（用户激活时调用，无需管理密钥） ====================
      if (action === 'code_activate') {
        const code = String(body.code || '').trim();
        if (!code) return fail('empty code');
        const key = 'code:' + code;
        const recRaw = await env.SYNC_KV.get(key);
        if (!recRaw) return fail('not_registered', 404); // 未在云端登记 → 前端降级本地激活
        let rec = JSON.parse(recRaw);
        if (rec.status === 'used') return fail('already_used', 409); // 已被使用 → 拒绝
        rec.status = 'used';
        rec.usedAt = Date.now();
        rec.device = String(body.device || '') || null;
        const type = rec.type || 'pro';
        await env.SYNC_KV.put(key, JSON.stringify(rec), { metadata: { status: 'used', months: rec.months, batch: rec.batch || '', type } });
        // 透传 type/tokens（token 包：前端负责把 tokens 记入本地额度；云端入账待 token 包方案定稿后启用）
        const resp = { months: rec.months, status: 'used', type };
        if (rec.tokens) resp.tokens = rec.tokens;
        return ok(resp);
      }

      // ==================== 管理端（需 X-Admin-Key） ====================
      if (['code_issue', 'code_list', 'code_stats', 'user_list', 'user_delete'].includes(action)) {
        if (!adminOk(env, request)) return fail('unauthorized', 401);
      }
      if (action === 'code_issue') {
        const code = String(body.code || '').trim();
        const months = parseInt(body.months, 10) || 12;
        const batch = String(body.batch || 'default').slice(0, 40);
        const type = body.type === 'tokens' ? 'tokens' : 'pro';
        const tokens = parseInt(body.tokens, 10) || 0;
        if (!code) return fail('empty code');
        const key = 'code:' + code;
        const exists = await env.SYNC_KV.get(key);
        if (exists) return fail('code_exists', 409);
        const rec = { status: 'unused', months, batch, issuedAt: Date.now(), type };
        if (type === 'tokens') rec.tokens = tokens;
        await env.SYNC_KV.put(key, JSON.stringify(rec), { metadata: { status: 'unused', months, batch, type } });
        return ok({ code, type });
      }
      if (action === 'code_list') {
        const list = await env.SYNC_KV.list({ prefix: 'code:' });
        const items = [];
        for (const k of list.keys || []) {
          const code = k.name.slice(5);
          const meta = k.metadata || {};
          let usedAt = null, device = null, type = meta.type || 'pro', tokens = 0;
          if (meta.status === 'used') {
            try {
              const rec = JSON.parse(await env.SYNC_KV.get(k.name));
              usedAt = rec.usedAt || null;
              device = rec.device || null;
              type = rec.type || 'pro';
              tokens = rec.tokens || 0;
            } catch (e) {}
          }
          items.push({ code, status: meta.status || 'unknown', months: meta.months || 0, batch: meta.batch || '', usedAt, device, type, tokens });
        }
        return ok({ total: items.length, items });
      }
      if (action === 'code_stats') {
        const list = await env.SYNC_KV.list({ prefix: 'code:' });
        let total = 0, used = 0, unused = 0;
        for (const k of list.keys || []) {
          total++;
          const meta = k.metadata || {};
          if (meta.status === 'used') used++;
          else unused++;
        }
        return ok({ total, used, unused });
      }
      if (action === 'user_list') {
        const list = await env.SYNC_KV.list({ prefix: 'user:' });
        const items = [];
        for (const k of list.keys || []) {
          try {
            const rec = JSON.parse(await env.SYNC_KV.get(k.name));
            items.push({ username: k.name.slice(5), createdAt: rec.createdAt || null, plan: rec.plan || { ...EMPTY_PLAN } });
          } catch (e) {}
        }
        return ok({ total: items.length, items });
      }
      if (action === 'user_delete') {
        const u = String(body.username || '').trim();
        if (!validUsername(u)) return fail('invalid username');
        await env.SYNC_KV.delete('user:' + u);
        await env.SYNC_KV.delete('sync:' + u);
        // 会话由 authByToken 校验用户存在性，用户删除后即自动失效（无需逐一枚举随机 token）
        return ok({ username: u });
      }

      return fail('unknown action');
    } catch (e) {
      return fail(e.message, 500);
    }
  },
};
