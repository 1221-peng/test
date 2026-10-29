// RelayCore 视频生成：创建任务 -> 轮询 -> 下载 mp4
//
// Grok 文生视频: node video.mjs --model grok-imagine-video --prompt "黄昏空荡的海边公路" --duration 8 --aspect 16:9 --resolution 720p
// Grok 首帧:     node video.mjs --model grok-imagine-video-1.5 --prompt "镜头缓慢后拉" --image https://example.com/a.png
// Grok 首尾帧:   node video.mjs --model grok-imagine-video-1.5 --prompt "从第一帧过渡到最后一帧" --image https://a.png --last-frame https://b.png
// Seedance 类:   node video.mjs --model seedance-2.0-0826-480p --prompt "..." --seconds 15 --aspect 16:9 --resolution 480p
//
// 参数: --model --prompt --duration --seconds --aspect --resolution --image --last-frame --ref --audio --negative --seed --out --interval --timeout --dry-run
// 重要: 创建 / 查询 / 下载必须用同一把 Key，否则 404 Video request not found
import path from 'node:path';
import { loadEnv, parseArgs, api, sleep, defaultOut, fs } from './lib.mjs';

const args = parseArgs();
const model = args.model && args.model !== true ? String(args.model) : null;
if (!model) {
  console.error('缺少 --model。先跑 `node models.mjs` 看可用模型，例如 grok-imagine-video');
  process.exit(1);
}

const name = model.toLowerCase();
const isGrok = name.startsWith('grok-imagine-video');
const prompt = args.prompt && args.prompt !== true ? String(args.prompt) : (args._[0] ? String(args._[0]) : '');
const interval = Number(args.interval || 3000);
const timeoutMs = Number(args.timeout || 10 * 60 * 1000);

// ---------- 按模型名推断允许参数（规则来自官方文档） ----------
function rulesFor(n) {
  const list = (s) => s.split(',');
  const m = n.match(/(?:^|[-_/])(\d+)s(?:$|[-_/])/); // ya-sd25-30s -> 30
  if (m) return { min: +m[1], max: +m[1], def: +m[1], aspects: list('21:9,16:9,4:3,1:1,3:4,9:16'), resolution: 'auto', extras: false };
  if (n.includes('seedance') && n.includes('0826'))
    return { min: 15, max: 15, def: 15, aspects: list('21:9,16:9,4:3,1:1,3:4,9:16,adaptive'), resolution: 'auto', extras: true };
  if (n === 'seedance-2.5' || n === 'seedance2.5' || /^seedance-2\.5(?:$|[-_/])/.test(n))
    return { min: 5, max: 20, def: 5, aspects: list('16:9,9:16,1:1'), resolution: null, extras: false };
  if (n === 'seedance-2.0:i2v' || n === 'seedance-2.0-i2v' || n.includes('903cf') || n.includes('seedance-2.0'))
    return { min: 10, max: 15, def: 10, aspects: list('16:9,9:16,1:1'), resolution: 'auto', needImage: true, extras: false };
  if (n.includes('ya-sd25-30s') || n.includes('sd25-30s'))
    return { min: 30, max: 30, def: 30, aspects: list('21:9,16:9,4:3,1:1,3:4,9:16'), resolution: 'auto', extras: false };
  if (n === 'sd20-c-ref' || n === 'sd25-c-ref')
    return { min: 5, max: 5, def: 5, aspects: list('16:9,9:16,1:1'), resolution: 'auto', needImage: true, singleImage: true, extras: false };
  if (n === 'seedance2.5-a')
    return { min: 4, max: 30, def: 4, aspects: list('21:9,16:9,4:3,1:1,3:4,9:16'), resolution: 'auto', extras: false };
  if (n.includes('seedance'))
    return { min: 15, max: 15, def: 15, aspects: list('16:9,9:16,1:1'), resolution: 'auto', extras: false };
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 非 Grok 模型（seedance 等）的创建体 */
function buildNonGrokBody() {
  const r = rulesFor(name);
  if (!r) throw new Error(`不认识的视频模型: ${model}。请用 \`node models.mjs\` 确认名字`);
  const aspect = String(args.aspect || r.aspects[0] || '16:9');
  if (!r.aspects.includes(aspect)) throw new Error(`画幅 ${aspect} 不被 ${model} 支持，可选: ${r.aspects.join(', ')}`);

  const want = args.seconds && args.seconds !== true ? Number(args.seconds) : r.def;
  const n = clamp(Math.round(want), r.min, r.max);
  if (args.seconds && Number(args.seconds) !== n) console.log(`[提示] ${model} 只允许 ${r.min}~${r.max} 秒，已把 ${args.seconds} 调整为 ${n}`);

  let resolution;
  if (r.resolution === null) resolution = undefined; // seedance-2.5 / seedance2.5 不要传
  else {
    const inName = /1080p/.test(name) ? '1080p' : /720p/.test(name) ? '720p' : /480p/.test(name) ? '480p' : null;
    resolution = String(args.resolution || inName || '720p');
    if (inName && resolution !== inName) throw new Error(`模型名里已写死 ${inName}，resolution 必须也是 ${inName}`);
  }

  const body = { model, prompt, seconds: String(n), duration: n, aspect_ratio: aspect };
  if (resolution) body.resolution = resolution;

  const refs = args.ref && args.ref !== true ? String(args.ref).split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (args.image && args.image !== true) refs.unshift(String(args.image));
  if (r.needImage && refs.length === 0) throw new Error(`${model} 必须带 --image（公网 https 图片地址）`);
  if (refs.length) {
    if (r.singleImage && refs.length > 1) throw new Error(`${model} 只能带一张参考图`);
    body.input_reference = refs[0];
    body.images = refs.length === 1 ? refs[0] : refs;
  }
  if (r.extras) {
    if (args.audio !== undefined) body.generate_audio = String(args.audio) === 'true';
    if (args.negative && args.negative !== true) body.negative_prompt = String(args.negative);
    if (args.seed && args.seed !== true) body.seed = Number(args.seed);
  }
  return body;
}

/** Grok 模型的创建体（图片是 {url,type} 对象） */
function buildGrokBody() {
  const obj = (u) => ({ url: String(u), type: 'image_url' });
  const body = { model, prompt };
  if (args.duration && args.duration !== true) body.duration = clamp(Math.round(Number(args.duration)), 1, 15);
  if (args.aspect && args.aspect !== true) {
    if (!['16:9', '9:16', '1:1'].includes(String(args.aspect))) throw new Error('grok 视频画幅只能是 16:9 / 9:16 / 1:1');
    body.aspect_ratio = String(args.aspect);
  }
  if (args.resolution && args.resolution !== true) {
    if (!['480p', '720p', '1080p'].includes(String(args.resolution))) throw new Error('grok 分辨率只能是 480p / 720p / 1080p');
    body.resolution = String(args.resolution);
  }

  const refs = args.ref && args.ref !== true ? String(args.ref).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const is15 = name === 'grok-imagine-video-1.5';

  if (is15) {
    if (refs.length) {
      if (refs.length > 7) throw new Error('reference_images 最多 7 张');
      body.reference_images = refs.map(obj);
    } else if (args.image && args.image !== true && args['last-frame'] && args['last-frame'] !== true) {
      body.image = obj(args.image);
      body.last_frame = obj(args['last-frame']);
    } else if (args.image && args.image !== true) {
      body.image = obj(args.image);
    } else if (!prompt) {
      throw new Error('grok-imagine-video-1.5 需要 --image / --ref，或至少给 --prompt');
    }
  } else if (args.image && args.image !== true) {
    body.images = [obj(args.image)]; // 首帧：数组里放一个对象
  }
  if (!body.prompt) delete body.prompt; // 1.5 首尾帧模式允许空提示词
  return body;
}

const body = isGrok ? buildGrokBody() : buildNonGrokBody();

if (args['dry-run']) {
  console.log('[dry-run] 不调用接口、不扣费');
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const { key, base } = loadEnv();

// ---------- 1. 创建任务 ----------
console.log('[1/3] POST ' + base + '/videos');
console.log(JSON.stringify(body, null, 2));
const created = await api(base, key, '/videos', { method: 'POST', body });
const taskId =
  [created.id, created.request_id, created.task_id, created.data?.id, created.data?.request_id, created.data?.task_id,
    created.video?.id, created.video?.request_id, created.video?.task_id].find((v) => typeof v === 'string' && v) || null;
if (!taskId) throw new Error('创建响应里没有任务 id: ' + JSON.stringify(created).slice(0, 300));
console.log(`[2/3] 任务已创建: ${taskId}  status=${created.status ?? '-'}`);

// ---------- 2. 轮询 ----------
const DONE = ['completed', 'complete', 'done', 'success', 'succeeded'];
const FAIL = ['failed', 'failure', 'error', 'expired', 'cancelled', 'canceled'];
const start = Date.now();
let last = '';
for (;;) {
  await sleep(interval);
  const j = await api(base, key, `/videos/${encodeURIComponent(taskId)}`);
  const status = String(j.status ?? j.data?.status ?? j.video?.status ?? j.state ?? j.data?.state ?? '').toLowerCase();
  const progress = j.progress ?? j.data?.progress;
  if (status !== last) {
    console.log(`    轮询: status=${status || '(空)'}${progress !== undefined ? ' progress=' + progress : ''}`);
    last = status;
  }
  if (DONE.includes(status)) break;
  if (FAIL.includes(status)) {
    const msg = j.error?.message || j.data?.error?.message || j.message || '(无错误信息)';
    throw new Error(`任务失败: ${status} - ${msg}`);
  }
  if (Date.now() - start > timeoutMs) {
    console.log(`[超时] 已等待 ${Math.round(timeoutMs / 1000)}s，任务未取消，可稍后用同一 id 继续查: ${taskId}`);
    process.exit(2);
  }
}

// ---------- 3. 下载 mp4（响应体是二进制，不是 JSON） ----------
const out = path.resolve(String(args.out || defaultOut('video', 'mp4')));
fs.mkdirSync(path.dirname(out), { recursive: true });
console.log('[3/3] GET ' + base + `/videos/${encodeURIComponent(taskId)}/content`);
const res = await api(base, key, `/videos/${encodeURIComponent(taskId)}/content`, { raw: true });
fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log('已保存:', out, `(${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
