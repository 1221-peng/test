// 列出这把 Key 可用的模型（免费，不扣额度）
// 用法: node models.mjs
import { loadEnv, api } from './lib.mjs';

const { key, base } = loadEnv();
console.log('Base URL:', base);

const json = await api(base, key, '/models');
const ids = (json.data || []).map((m) => m.id);

const isVideo = (id) => /video/i.test(id);
const video = ids.filter(isVideo);
const image = ids.filter((id) => !isVideo(id));

console.log(`\n共 ${ids.length} 个模型\n`);
if (image.length) {
  console.log(`生图 (${image.length}):`);
  for (const id of image) console.log('  ' + id);
}
if (video.length) {
  console.log(`\n视频 (${video.length}):`);
  for (const id of video) console.log('  ' + id);
}
if (!ids.length) console.log('(空列表：这把 Key 所属分组没有分配模型)');
