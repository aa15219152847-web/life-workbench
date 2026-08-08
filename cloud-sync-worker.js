/**
 * Lan工作台 · 云同步 + 兑换码核销 Worker（Cloudflare Workers + KV）
 *
 * 功能：
 * 1. 云同步：put/get（AES-GCM 加密备份，服务端不落明文）
 * 2. 兑换码核销：code_activate（一次一码，防复用）
 * 3. 兑换码管理（需 X-Admin-Key 头鉴权）：code_issue / code_list / code_stats
 *
 * KV 结构：
 * - lan_sync          云同步加密备份
 * - code:<code>       兑换码记录 {status, months, batch, issuedAt, usedAt, device}
 *   （写时带 metadata:{status, months, batch}，便于 list 快速统计）
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail('method not allowed', 405);
    try {
      const body = await request.json();
      const action = body.action || '';

      // ---- 云同步 ----
      if (action === 'put') {
        if (!body.body || typeof body.body !== 'string') return fail('empty body');
        const parsed = JSON.parse(body.body);
        const savedAt = parsed && parsed.savedAt ? parsed.savedAt : new Date().toISOString();
        await env.SYNC_KV.put('lan_sync', body.body, { metadata: { savedAt } });
        return ok({ savedAt });
      }
      if (action === 'get') {
        const val = await env.SYNC_KV.get('lan_sync');
        if (!val) return fail('no backup yet', 404);
        return new Response(val, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ---- 兑换码核销（用户激活时调用，无需管理密钥）----
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
        await env.SYNC_KV.put(key, JSON.stringify(rec), { metadata: { status: 'used', months: rec.months, batch: rec.batch || '' } });
        return ok({ months: rec.months, status: 'used' });
      }

      // ---- 管理端（需 X-Admin-Key）----
      if (action === 'code_issue' || action === 'code_list' || action === 'code_stats') {
        if (!adminOk(env, request)) return fail('unauthorized', 401);
      }
      if (action === 'code_issue') {
        const code = String(body.code || '').trim();
        const months = parseInt(body.months, 10) || 12;
        const batch = String(body.batch || 'default').slice(0, 40);
        if (!code) return fail('empty code');
        const key = 'code:' + code;
        const exists = await env.SYNC_KV.get(key);
        if (exists) return fail('code_exists', 409);
        const rec = { status: 'unused', months, batch, issuedAt: Date.now() };
        await env.SYNC_KV.put(key, JSON.stringify(rec), { metadata: { status: 'unused', months, batch } });
        return ok({ code });
      }
      if (action === 'code_list') {
        const list = await env.SYNC_KV.list({ prefix: 'code:' });
        const items = [];
        for (const k of list.keys || []) {
          const code = k.name.slice(5);
          const meta = k.metadata || {};
          let usedAt = null, device = null;
          if (meta.status === 'used') {
            try {
              const rec = JSON.parse(await env.SYNC_KV.get(k.name));
              usedAt = rec.usedAt || null;
              device = rec.device || null;
            } catch (e) {}
          }
          items.push({ code, status: meta.status || 'unknown', months: meta.months || 0, batch: meta.batch || '', usedAt, device });
        }
        return ok({ total: items.length, items });
      }
      if (action === 'code_stats') {
        const list = await env.SYNC_KV.list({ prefix: 'code:' });
        const now = Date.now();
        let total = 0, used = 0, unused = 0;
        for (const k of list.keys || []) {
          total++;
          const meta = k.metadata || {};
          if (meta.status === 'used') used++;
          else if (meta.status === 'unused') {
            const months = parseInt(meta.months, 10) || 12;
            const issuedAt = k.metadata ? null : null;
            unused++;
          } else unused++;
        }
        return ok({ total, used, unused });
      }

      return fail('unknown action');
    } catch (e) {
      return fail(e.message, 500);
    }
  },
};
