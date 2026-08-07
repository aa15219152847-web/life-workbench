#!/usr/bin/env node
/**
 * Lan工作台 · PRO 兑换码生成工具（发码用，仅你本人运行）
 *
 * 用法:
 *   node issue-license.js 12        # 生成 12 个月兑换码
 *   node issue-license.js 12 3      # 生成 3 个 12 个月兑换码
 *
 * 密钥必须与 index.html 中 LICENSE_HMAC_KEY 一致。
 * 默认读取环境变量 LICENSE_SECRET，未设置时用默认值（请务必改成强密钥）。
 */
const crypto = require('crypto');

const SECRET = process.env.LICENSE_SECRET || 'lan-workbench-license-v1-secret';

function makeCode(months) {
  const payload = {
    v: 1,
    months: months,
    issue: Date.now(),
    exp: Date.now() + months * 30 * 24 * 3600 * 1000,
  };
  // 标准 base64（浏览器 atob 可直接解码），去掉 = 号避免歧义
  const body = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

const months = parseInt(process.argv[2] || '12', 10);
const count = parseInt(process.argv[3] || '1', 10);

console.log(`=== Lan工作台 PRO 兑换码（${months} 个月 × ${count} 个）===`);
for (let i = 0; i < count; i++) {
  console.log(makeCode(months));
}
console.log('=== 复制给用户即可，支持离线激活 ===');
