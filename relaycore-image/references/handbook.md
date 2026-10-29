# RelayCore（relaycore.cn）API 操作手册

> 基于官方文档 <https://relaycore.cn/docs> 整理，并用实际 Key 实测了鉴权、模型列表和各接口的报错行为。
> 本文件是 `relaycore-image` skill 的参考资料；可执行脚本在同级 `../scripts/`。

---

## 0. 先看结论

| 项目 | 值 |
| --- | --- |
| API 域名（实测可用） | `https://api.relaycore.cn` |
| Base URL（SDK 用） | `https://api.relaycore.cn/v1` |
| 鉴权 | `Authorization: Bearer sk-...`（也支持 `x-api-key` / `x-goog-api-key`） |
| 接口风格 | OpenAI 兼容（`/v1/models`、`/v1/images/*`、`/v1/videos/*`） |
| 你这把 Key 的分组能力 | **16 个生图模型 + 2 个 Grok 视频模型**；聊天模型会直接报 `model_not_found` |

**关键点：Base URL 已经带 `/v1`，后面直接接 `/models`、`/images/generations`、`/videos`，不要再拼一个 `/v1`。**

---

## 1. 第一步：确认这把 Key 能调什么

```bash
curl https://api.relaycore.cn/v1/models \
  -H "Authorization: Bearer $RELAYCORE_API_KEY"
```

实测返回 18 个模型：

- **生图（16 个）**：`gpt-image-2`、`gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2-exact`、`gpt-image-1k-th`、`gemini-3-pro-image-preview`、`gemini-nano-banana-2.1`、`grok-imagine-image-2.0`、`grok-imagine-image-quality`、`nano-banana-pro-1k/2k/4k`、`nano-banana2-1k/2k/4k`
- **视频（2 个）**：`grok-imagine-video`、`grok-imagine-video-1.5`

`model` 必须**逐字**等于上面的 id（大小写、连字符、冒号都算）。文档里的示例名（如 `seedance-2.0-0826-480p`）不在这个列表里，说明它们是别的分组的模型；用你这把 Key 发过去会失败。

> 顺带说明：`POST /v1/chat/completions` 会返回
> `{"error":{"message":"Model \"gpt-4o-mini\" is not supported by the current group","type":"model_not_found"}}`
> 想跑聊天模型需要在控制台创建一把「聊天分组」的 Key。

---

## 2. 生成图片（同步接口）

`POST {Base}/images/generations`，JSON 请求体。

```bash
curl https://api.relaycore.cn/v1/images/generations \
  -H "Authorization: Bearer $RELAYCORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A clean product photo on a dark stone surface",
    "size": "1536x1024",
    "quality": "high"
  }'
```

响应：

```json
{
  "created": 1785931200,
  "data": [{ "url": "https://..." }]
}
```

**读结果的两种形态**：优先读 `data[0].url`；如果返回的是 `data[0].b64_json`（部分线路会这样），做 Base64 解码后写文件。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `model` | 必填，必须来自 `/models` |
| `prompt` | 必填，不能为空字符串 |
| `size` | 如 `1024x1024`、`1536x1024`、`1024x1536` |
| `quality` | `high` / `medium` / `low`（按模型支持情况） |
| `n` | 生成张数 |

Python（官方 openai SDK，只换 `base_url` 和 `api_key`）：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://api.relaycore.cn/v1",
)

resp = client.images.generate(
    model="gpt-image-2",
    prompt="A clean product photo on a dark stone surface",
    size="1536x1024",
)
print(resp.data[0].url)
```

JavaScript（openai sdk 同理）：

```js
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.RELAYCORE_API_KEY, baseURL: 'https://api.relaycore.cn/v1' });
const r = await client.images.generate({ model: 'gpt-image-2', prompt: '一只戴墨镜的橘猫', size: '1024x1024' });
console.log(r.data[0].url ?? r.data[0].b64_json);
```

---

## 3. 编辑图片（multipart 表单）

`POST {Base}/images/edits`，`Content-Type: multipart/form-data`。

```bash
curl https://api.relaycore.cn/v1/images/edits \
  -H "Authorization: Bearer $RELAYCORE_API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=Replace the background with a modern studio" \
  -F "image=@product.png" \
  -F "size=1536x1024"
```

- `image`：源图片二进制
- `mask`：可选遮罩
- `model` / `prompt` / `size` / `quality`：普通表单字段

注意：这里不能用 JSON，必须是表单。

---

## 4. 异步生图 —— **本站在当前状态下未启用**

文档里写了 `POST /images/generations/async` + 轮询 `GET /images/tasks/{id}`，但实测：

```json
{"error":{"code":"not_found_error","message":"async image tasks are not enabled","type":"not_found_error"}}
```

结论：**用同步接口 `/images/generations` 即可**。如果以后站点开启对象存储，异步接口的用法是：

1. `POST {Base}/images/generations/async` → 返回 `id`
2. 每约 3 秒 `GET {Base}/images/tasks/{id}`（**必须用提交任务时的同一把 Key**）
3. `status` 为 `completed` 时读 `result.data[].url`（`image_url` 指向第一张）；`failed` 时看 `http_status` 和 `error.message`

---

## 5. 生成视频（四步流程）

视频是**异步任务**，一次生成分四步：查模型 → 创建任务 → 轮询 → 下载 mp4。
**创建、查询、下载必须用同一把 Key**，换 Key 查询会返回 `404 Video request not found`。

### 5.1 Grok 系列（你这把 Key 可用的两个）

```bash
# ① 创建任务
curl https://api.relaycore.cn/v1/videos \
  -H "Authorization: Bearer $RELAYCORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-imagine-video",
    "prompt": "A quiet coastal road at dusk, empty and wide",
    "duration": 8,
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }'
# -> {"id":"task_xxx","status":"queued"}

# ② 每 3 秒查一次
curl https://api.relaycore.cn/v1/videos/task_xxx \
  -H "Authorization: Bearer $RELAYCORE_API_KEY"

# ③ 成功后下载（响应体是 mp4 字节，不是 JSON）
curl https://api.relaycore.cn/v1/videos/task_xxx/content \
  -H "Authorization: Bearer $RELAYCORE_API_KEY" \
  -o output.mp4
```

Grok 参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `duration` | 整数 | 1~15，**不带引号**；不传时按 8 秒计费 |
| `aspect_ratio` | 字符串 | 只能 `16:9`、`9:16`、`1:1` |
| `resolution` | 字符串 | `480p` / `720p` / `1080p`，默认 `720p` |
| `images` | 对象数组 | `grok-imagine-video` 的首帧：`[{"url":"https://...","type":"image_url"}]` |
| `image` | 对象 | `grok-imagine-video-1.5` 的首帧（单个对象，不是数组） |
| `reference_images` | 对象数组 | `1.5` 的多参考图，最多 7 张 |
| `last_frame` | 对象 | `1.5` 的尾帧，与 `image` 同时出现 |

Grok **不要**传 `seconds`、`input_reference`、`generate_audio`、`negative_prompt`、`seed`、`size`。

### 5.2 Seedance 系列（文档里详细写了，但不在你当前的模型列表里）

如果换了分组、`/models` 里出现 seedance 名字，按下面规则填：

- `seconds` 必须是**字符串**（`"15"`），`duration` 必须是**相同数值的整数**（`15`），两个都要带。缺一个会报 `missing_seconds`、`必须显式传 15`、`duration 为必填` 之类。
- `resolution` 只能是 `480p` / `720p` / `1080p`；名字里写了哪一档就必须传哪一档。名字正好是 `seedance-2.5` / `seedance2.5` 时**不要传** `resolution`（传了报 `video model has no configured resolution pricing`）。
- 名字同时含 `seedance` 和 `0826`（如 `seedance-2.0-0826-480p`）：时长只能是 15，画幅可 `21:9/16:9/4:3/1:1/3:4/9:16/adaptive`，且只有这一类能带 `generate_audio`、`negative_prompt`、`seed`。
- 名字含 `i2v`、或是 `sd20-c-ref` / `sd25-c-ref`：必须带参考图，且参考图是**公网 https 字符串**（不是 `{url:...}` 对象），本机路径 / `data:` URL 都不行。
- `seconds`/`duration` 两者的换算、各模型的时长上限，脚本 `video.mjs` 已按文档规则实现，会自动夹到允许区间。

### 5.3 状态与计费

- 成功状态：`completed`、`complete`、`done`、`success`、`succeeded`
- 失败状态：`failed`、`failure`、`error`、`expired`、`cancelled`、`canceled` → 读 `error.message`
- `progress` 可以长期停在 0，**判断完成只看 `status`**
- 只有第一次变成成功状态时计一次费；重复查询、下载不再计费；失败状态不计成功费用
- 10 分钟只是建议等待时间，到点任务不会取消，仍可拿同一 id 继续查

---

## 6. 常见错误对照

| HTTP / 报错 | 含义与处理 |
| --- | --- |
| `401 API_KEY_REQUIRED` | 没带 `Authorization: Bearer ...` |
| `401` | Key 无效，或不是当前分组的 Key |
| `403` + 分组不允许生图 | 换分组或找管理员开权限 |
| `400 images endpoint requires an image model` | `model` 不是生图模型 |
| `400 prompt: Field required` | 少了 `prompt` |
| `400 model is required` | 视频创建少了 `model` |
| `404 async image tasks are not enabled` | 本站没开异步生图，改用同步接口 |
| `404 Video request not found` | 查询/下载用了另一把 Key，或 id 错 |
| `404` 且路径看着对 | 检查 URL 是否重复拼了 `/v1` |
| `429` | 按 `Retry-After` 等待后用同一请求重试 |
| `5xx` | 同一请求最多再试 2 次，不要改路径 |

---

## 7. 配套脚本

可执行脚本在本 skill 的 `../scripts/` 目录（零依赖，Node 18+）：

| 文件 | 作用 |
| --- | --- |
| `scripts/.env` | 存放 Key 和 Base URL（明文，别提交到仓库） |
| `scripts/lib.mjs` | 读配置、发请求、存图 |
| `scripts/models.mjs` | 列出可用模型（免费） |
| `scripts/image.mjs` | 生图 / 改图 |
| `scripts/video.mjs` | 创建视频任务 → 轮询 → 下载 mp4 |

```bash
S="<skill 目录>/scripts"   # 例如 .../.dsh/skills/relaycore-image/scripts

# 看模型
node "$S/models.mjs"

# 生图（不指定 --out 时落到 ./outputs/）
node "$S/image.mjs" --prompt "一只戴墨镜的橘猫" --model gpt-image-2.5-sunburst --size 1536x1024

# 改图
node "$S/image.mjs" --prompt "把背景换成纯白" --edit ./src.png --model gpt-image-2

# 视频（Grok 文生视频）
node "$S/video.mjs" --model grok-imagine-video --prompt "黄昏空荡的海边公路" --duration 8 --aspect 16:9 --resolution 720p

# 视频（Grok 1.5 首尾帧）
node "$S/video.mjs" --model grok-imagine-video-1.5 --prompt "从第一帧过渡到最后一帧" --image https://a.png --last-frame https://b.png

# 只看将要发送的 JSON，不调用、不扣费
node "$S/video.mjs" --model grok-imagine-video --prompt "..." --dry-run
node "$S/image.mjs" --prompt "..." --model gpt-image-2 --dry-run
```

---

## 8. 计费与安全提醒

- 图片/视频按次或按秒计费，具体单价看控制台「模型广场」，文档不写金额；视频成功后可在「使用记录」核对扣费。
- Key 只放服务端，别写进前端代码或公开仓库；`.env` 已在本地目录，泄露后请在控制台禁用重建。
- 充值比例、退款、套餐规则以站内公告/条款为准（`https://relaycore.cn/legal/terms`）。
