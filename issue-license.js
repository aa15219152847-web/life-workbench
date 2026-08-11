#!/usr/bin/env node
/**
 * Lan工作台 · PRO/Token 兑换码生成工具（发码用，仅你本人运行）
 *
 * 用法:
 *   node issue-license.js 12            # 生成 1 个 12 个月 PRO 兑换码（默认）
 *   node issue-license.js 3 10          # 生成 10 个 3 个月 PRO 码
 *   node issue-license.js 1 5 种子用户  # 生成 5 个 1 个月码，批次"种子用户"
 *   node issue-license.js tokens 1000000 5 2026首批  # 生成 5 个 100 万 token 包码（token 包上线前请勿发给用户）
 *   node issue-license.js --list        # 查看本地发码台账
 *   node issue-license.js --export      # 导出全部台账 JSON 到当前目录
 *
 * PRO 时长支持：1（月付）/ 3（季付）/ 12（年付）
 * token 包：type=tokens + tokens 数量（当前为协议预留，等前端 token 包方案上线后再对外发放）
 * 每次发码自动追加到本地台账 codes-ledger.json（不依赖网络）。
 * 密钥必须与 index.html / admin.html 中 LICENSE_HMAC_KEY 一致。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = process.env.LICENSE_SECRET || 'bae65342981bdfa1b9daea36b2126c79844d0f0de2961c4d411e2adcdc8c2e60';
const LEDGER = path.join(__dirname, 'codes-ledger.json');

function makeCode(type, months, tokens) {
  const payload = { v: 1, type, issue: Date.now(), exp: Date.now() + (type === 'tokens' ? 365 : months) * 24 * 3600 * 1000 };
  if (type === 'pro') payload.months = months;
  if (type === 'tokens') payload.tokens = tokens;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

function loadLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); }
  catch (e) { return []; }
}

function saveLedger(list) {
  fs.writeFileSync(LEDGER, JSON.stringify(list, null, 2), 'utf8');
}

function listLedger() {
  const list = loadLedger();
  if (!list.length) { console.log('台账为空（codes-ledger.json 不存在或没有记录）'); return; }
  const now = Date.now();
  console.log(`=== 发码台账（共 ${list.length} 条）===`);
  console.log('状态\t类型\t时长/数量\t批次\t\t发码时间\t\t兑换码');
  for (const it of list) {
    const expired = it.exp < now ? '已过期' : '有效';
    const spec = it.type === 'tokens' ? (it.tokens / 10000) + '万token' : (it.months || '?') + '个月';
    console.log(`${expired}\t${it.type || 'pro'}\t${spec}\t${(it.batch || '-').slice(0, 8)}\t${new Date(it.issue).toLocaleString('zh-CN')}\t${it.code}`);
  }
}

// ---- 主逻辑 ----
const arg = process.argv[2];

if (arg === '--list') {
  listLedger();
  process.exit(0);
}
if (arg === '--export') {
  const list = loadLedger();
  const file = path.join(__dirname, `ledger-export-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), total: list.length, items: list }, null, 2), 'utf8');
  console.log(`已导出 ${list.length} 条台账到 ${file}`);
  process.exit(0);
}

const ledger = loadLedger();
const codes = [];

if (arg === 'tokens' || arg === '--tokens') {
  // token 包码（协议预留，前端 token 包方案上线前不要对外发放）
  const tokens = parseInt(process.argv[3] || '0', 10);
  const count = parseInt(process.argv[4] || '1', 10);
  const batch = process.argv.slice(5).join(' ') || 'token-packs';
  if (tokens < 10000) { console.log('token 数量至少 1 万'); process.exit(1); }
  if (count < 1 || count > 100) { console.log('数量需在 1~100 之间'); process.exit(1); }
  console.log(`=== Lan工作台 Token 包兑换码（${(tokens / 10000).toLocaleString()} 万 × ${count} 个，批次「${batch}」）===`);
  console.log('⚠️ 注意：token 包功能尚未上线，此批码暂不能发给用户！');
  for (let i = 0; i < count; i++) {
    const code = makeCode('tokens', 0, tokens);
    codes.push(code);
    ledger.push({ code, type: 'tokens', tokens, batch, issue: Date.now(), exp: Date.now() + 365 * 24 * 3600 * 1000 });
  }
} else {
  const months = parseInt(arg || '12', 10);
  const count = parseInt(process.argv[3] || '1', 10);
  const batch = process.argv.slice(4).join(' ') || 'manual';
  if (![1, 3, 12].includes(months)) {
    console.log('时长仅支持 1 / 3 / 12 个月');
    process.exit(1);
  }
  if (count < 1 || count > 100) {
    console.log('数量需在 1~100 之间');
    process.exit(1);
  }
  console.log(`=== Lan工作台 PRO 兑换码（${months} 个月 × ${count} 个，批次「${batch}」）===`);
  for (let i = 0; i < count; i++) {
    const code = makeCode('pro', months, 0);
    codes.push(code);
    ledger.push({ code, type: 'pro', months, batch, issue: Date.now(), exp: Date.now() + months * 30 * 24 * 3600 * 1000 });
  }
}
saveLedger(ledger);
for (const c of codes) console.log(c);
console.log('=== 已登记到本地台账 codes-ledger.json · 复制给用户即可，支持离线激活 ===');
