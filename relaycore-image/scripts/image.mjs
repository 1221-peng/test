// RelayCore 生图 / 改图
//
// 生成: node image.mjs --prompt "一只戴墨镜的橘猫" --model gpt-image-2.5-sunburst --size 1024x1024
// 改图: node image.mjs --prompt "把背景换成纯白" --edit ./src.png --model gpt-image-2
// 预演: 加 --dry-run 只打印请求体，不调用、不扣费
//
// 参数: --prompt --model --size --quality --n --out --edit --mask --dry-run
import path from 'node:path';
import { loadEnv, parseArgs, api, saveImageResult, defaultOut, fs } from './lib.mjs';

const args = parseArgs();
const prompt = args.prompt || args._[0];
if (!prompt || prompt === true) {
  console.error('缺少 --prompt。示例:\n  node image.mjs --prompt "一只戴墨镜的橘猫" --model gpt-image-2.5-sunburst --size 1024x1024');
  process.exit(1);
}

const model = String(args.model || 'gpt-image-2');
const size = String(args.size || '1024x1024');
const quality = args.quality && args.quality !== true ? String(args.quality) : undefined;
const n = Number(args.n || 1);

if (args['dry-run']) {
  console.log('[dry-run] 不调用接口、不扣费');
  console.log(JSON.stringify({
    endpoint: args.edit ? 'POST /images/edits (multipart/form-data)' : 'POST /images/generations',
    model, prompt: String(prompt), size, ...(quality ? { quality } : {}), ...(args.edit ? { image: String(args.edit), mask: args.mask ? String(args.mask) : undefined } : { n }),
  }, null, 2));
  process.exit(0);
}

const { key, base } = loadEnv();
const out = path.resolve(String(args.out || defaultOut('image', 'png')));
fs.mkdirSync(path.dirname(out), { recursive: true });

const t0 = Date.now();
let json;
if (args.edit && args.edit !== true) {
  // ---- 改图：multipart ----
  const src = path.resolve(String(args.edit));
  if (!fs.existsSync(src)) throw new Error('找不到源图: ' + src);
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', String(prompt));
  form.set('size', size);
  if (quality) form.set('quality', quality);
  form.set('image', new Blob([fs.readFileSync(src)], { type: guessType(src) }), path.basename(src));
  if (args.mask && args.mask !== true) {
    const mask = path.resolve(String(args.mask));
    form.set('mask', new Blob([fs.readFileSync(mask)], { type: guessType(mask) }), path.basename(mask));
  }
  console.log(`[改图] model=${model} size=${size}`);
  json = await api(base, key, '/images/edits', { method: 'POST', body: form });
} else {
  // ---- 文生图：JSON ----
  const body = { model, prompt: String(prompt), size, n };
  if (quality) body.quality = quality;
  console.log(`[生图] model=${model} size=${size}${quality ? ' quality=' + quality : ''} n=${n}`);
  json = await api(base, key, '/images/generations', { method: 'POST', body });
}

const saved = await saveImageResult(json, out);
console.log('已保存:', saved.file);
if (saved.url) console.log('远程地址:', saved.url);
if (json.usage) console.log('用量:', JSON.stringify(json.usage));
console.log(`耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

function guessType(p) {
  const e = path.extname(p).toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  return 'image/png';
}
