/**
 * Lan工作台 · 云同步 Worker（Cloudflare Workers + KV）
 *
 * 部署步骤（明天配合执行）：
 * 1. 注册 Cloudflare 账号（https://dash.cloudflare.com）免费
 * 2. 创建 Worker：Workers & Pages → Create → Worker，粘贴本文件
 * 3. 绑定 KV：Settings → KV namespace bindings → 创建/绑定名称为 SYNC_KV
 * 4. 部署后得到地址 https://你的子域.workers.dev
 * 5. 把该地址填入 index.html 中的 CLOUD_SYNC_ENDPOINT（const 常量），重新 push
 *
 * 数据流：
 * - POST {action:'put', body:'<AES-GCM 加密后的 JSON>'} → 存入 KV
 * - POST {action:'get'} → 返回 {iv, data, savedAt}
 * 服务端不落任何明文，仅存密文。同步码只在用户浏览器内派生密钥。
 */

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    try {
      const body = await request.json();
      if (body.action === 'put') {
        if (!body.body || typeof body.body !== 'string') {
          return new Response(JSON.stringify({ ok: false, error: 'empty body' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        const parsed = JSON.parse(body.body);
        const savedAt = parsed && parsed.savedAt ? parsed.savedAt : new Date().toISOString();
        await env.SYNC_KV.put('lan_sync', body.body, { metadata: { savedAt } });
        return new Response(JSON.stringify({ ok: true, savedAt }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (body.action === 'get') {
        const val = await env.SYNC_KV.get('lan_sync');
        if (!val) {
          return new Response(JSON.stringify({ ok: false, error: 'no backup yet' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        return new Response(val, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },
};
