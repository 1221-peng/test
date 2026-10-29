// RelayCore 公共工具：配置解析、参数解析、请求封装、图片落盘
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname; // 本文件所在目录（scripts/）

/** 依次尝试的配置文件位置（环境变量优先级最高，命中即止） */
const ENV_CANDIDATES = [
  path.join(DIR, '.env'),                             // 技能自带
  path.join(DIR, '..', '..', 'relaycore.env'),        // <skills 根>/relaycore.env
  path.join(DIR, '..', '..', '..', 'relaycore.env'),  // <dshHome>/relaycore.env，如 ~/.dsh/relaycore.env
  path.join(process.cwd(), '.env'),                   // 当前项目
];

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().replace(/^export\s+/, '');
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k) out[k] = v;
  }
  return out;
}

/** 返回 { key, base }；缺 Key 时给出可操作的报错 */
export function loadEnv() {
  const fileEnv = Object.assign({}, ...ENV_CANDIDATES.map(readEnvFile));
  const key = process.env.RELAYCORE_API_KEY || fileEnv.RELAYCORE_API_KEY;
  const base = (process.env.RELAYCORE_BASE_URL || fileEnv.RELAYCORE_BASE_URL || 'https://api.relaycore.cn/v1').replace(/\/+$/, '');
  if (!key) {
    throw new Error(
      '缺少 RelayCore Key。三种方式任选：\n' +
      '  1) 设置环境变量 RELAYCORE_API_KEY\n' +
      '  2) 在 ' + path.join(DIR, '.env') + ' 写入 RELAYCORE_API_KEY=sk-...\n' +
      '  3) 在当前目录 .env 写入同样的键',
    );
  }
  if (!/^https?:\/\//.test(base)) throw new Error('RELAYCORE_BASE_URL 必须以 http(s):// 开头');
  return { key, base };
}

/** 极简参数解析：--name value / --flag / 位置参数进 _ */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[name] = true;
      else { out[name] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/** 统一请求：自动 Bearer、自动 JSON、非 2xx 抛出可读错误 */
export async function api(base, key, pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + pathname, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || j.message || text;
    } catch { /* 保留原文 */ }
    const err = new Error(`${method} ${pathname} -> HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

/** 默认输出路径：outputs/<prefix>-<时间戳>.<ext>，并确保目录存在 */
export function defaultOut(prefix, ext) {
  const dir = path.resolve(process.cwd(), 'outputs');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return path.join(dir, `${prefix}-${ts}.${ext}`);
}

/** data[0].url 或 data[0].b64_json -> 保存文件 */
export async function saveImageResult(json, outPath) {
  const item = json?.data?.[0];
  if (!item) throw new Error('响应里没有 data[0]：' + JSON.stringify(json).slice(0, 300));
  if (item.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, 'base64'));
    return { file: outPath };
  }
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error('下载图片失败 HTTP ' + r.status);
    fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
    return { file: outPath, url: item.url };
  }
  throw new Error('data[0] 里既没有 url 也没有 b64_json');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { fs, path, DIR };
