---
name: relaycore-image
description: RelayCore（relaycore.cn）生图与生视频 API：OpenAI 兼容接口，用 Key 调用 gpt-image / nano-banana / gemini / grok 等模型出图、改图，以及创建 Grok 视频任务并轮询下载 mp4。当用户要求生成图片、画图、出图、改图、做封面/海报/图标/配图，或生成视频时使用。
whenToUse: 用户要求生成或编辑图片、生成视频；或给出 relaycore 的 Key、提到 relaycore.cn / RelayCore 中转站。
metadata:
  version: "1.0.0"
  capability: image-generation
---

# RelayCore 生图 / 生视频

用 RelayCore 的 OpenAI 兼容接口完成「出图」和「出视频」。本 skill 自带可运行脚本，**不要手写 curl**，直接调脚本。

## 1. 硬性约束（先记住这几条）

| 项 | 值 |
| --- | --- |
| API 域名 | `https://api.relaycore.cn` |
| Base URL | `https://api.relaycore.cn/v1` |
| 鉴权头 | `Authorization: Bearer <key>`（也接受 `x-api-key`、`x-goog-api-key`） |
| 模型名 | 必须**逐字**等于 `GET /v1/models` 返回的 `id` |

- Base URL **已经带 `/v1`**，后面直接接 `/models`、`/images/generations`、`/videos`，**不要再拼一个 `/v1`**。
- 网页域名 `relaycore.cn` 不能当 API 用（实测连接超时 / 无路由），一律用 `api.relaycore.cn`。
- 拿到 Key 的第一件事是跑 `models.mjs`：**不要假设**某个模型名存在，文档里的示例名（如 `seedance-2.0-0826-480p`）可能属于别的分组。

## 2. 凭证

脚本按此顺序取 Key，命中即止：

1. 环境变量 `RELAYCORE_API_KEY`、`RELAYCORE_BASE_URL`
2. 技能自带的 `scripts/.env`
3. `<skills 根>/relaycore.env`
4. `<dshHome>/relaycore.env`（全局安装时 Key 放在 `~/.dsh/relaycore.env`）
5. 当前目录的 `.env`

**不要把 Key 打印到最终回答里**，也不要写进用户的前端代码。若缺少 Key，脚本会直接报错并列出可放置的位置，按提示补上即可，不要去猜一个 Key。

如果用户要把 skill 分享给别人，提醒先删掉含 Key 的 `.env` / `relaycore.env`。

## 3. 标准流程

1. **看模型**：`node <skill>/scripts/models.mjs`（免费，不扣额度）。
2. **选模型**（见第 4 节）。用户没指定就用默认值。
3. **生成**：
   ```bash
   node <skill>/scripts/image.mjs --prompt "提示词" --model gpt-image-2.5-sunburst --size 1024x1024 --out outputs/pic.png
   ```
4. **看结果**：用 `read_image` 打开生成的 png 确认内容，再把图贴给用户（`![说明](<路径>)`），需要交付文件时用 `present`。
5. **报告用量**：脚本会打印 `usage`（input/output/total tokens）与保存路径，一并转述，并提醒这次调用已计费。

`<skill>` 指本 SKILL.md 所在目录的绝对路径（加载结果会给出）。

## 4. 模型选择

生图模型大致分三档（以 `models.mjs` 实际返回为准）：

| 家族 | 典型 id | 用法 |
| --- | --- | --- |
| GPT Image | `gpt-image-2`、`gpt-image-2.5`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2-exact`、`gpt-image-1k-th` | 指令跟随最好，适合文字/版式/产品图；`sunburst`、`flare` 是风格变体，其余是版本/分辨率变体 |
| Nano Banana（Gemini） | `nano-banana2-1k/2k/4k`、`nano-banana-pro-1k/2k/4k`、`gemini-nano-banana-2.1`、`gemini-3-pro-image-preview` | 渲染质感好；后缀 `1k/2k/4k` 是输出分辨率档，越大越贵 |
| Grok Image | `grok-imagine-image-2.0`、`grok-imagine-image-quality` | 风格化、想象类画面 |

选择规则：
- 用户没指定 → 先用 `gpt-image-2.5-sunburst`（已验证可用），或 `gpt-image-2`。
- 要高清/印刷 → `nano-banana-pro-2k` 或 `*-4k`。
- 要便宜快速 → `nano-banana2-1k`、`gpt-image-1k-th`。
- 用户报错「不是生图模型」→ 说明该 id 属于别的分组，重新用 `models.mjs` 挑。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--prompt` | 必填，非空。写清主体、构图、风格、光线、背景 |
| `--model` | 必填（脚本默认 `gpt-image-2`） |
| `--size` | `1024x1024`（方）、`1536x1024`（横）、`1024x1536`（竖） |
| `--quality` | `high` / `medium` / `low`，按模型支持情况，不确定就不传 |
| `--n` | 张数，默认 1 |
| `--out` | 输出路径，默认 `outputs/image-<时间戳>.png` |
| `--edit <文件>` | 走改图接口（multipart），可再加 `--mask <文件>` |
| `--dry-run` | 只打印请求体，不调用、不扣费 |

## 5. 结果形态

响应可能是 `data[0].url`，也可能是 `data[0].b64_json`（部分线路）。脚本已统一处理并落盘成 png，无需关心。若返回 `url`，脚本会额外下载保存，并打印原始地址。

## 6. 改图

```bash
node <skill>/scripts/image.mjs --prompt "把背景换成纯白，保留人物" --edit ./src.png --model gpt-image-2 --out outputs/edited.png
```

改图必须走 `multipart/form-data`（脚本已处理）：`image` 为源图，`mask` 可选。**不能**用 JSON 打 `/images/edits`。

## 7. 异步生图：本站未启用

`POST /images/generations/async` 实测返回 `async image tasks are not enabled`。**不要用异步接口**，直接用同步 `/images/generations`。若某天站点开启，流程是：提交拿 `id` → 每 3 秒 `GET /images/tasks/{id}`（同一把 Key）→ `completed` 后读 `result.data[].url`。

## 8. 视频（Grok，四步）

创建 / 查询 / 下载**必须同一把 Key**（换 Key 会 404 `Video request not found`）。

```bash
# 文生视频
node <skill>/scripts/video.mjs --model grok-imagine-video --prompt "黄昏空荡的海边公路" --duration 8 --aspect 16:9 --resolution 720p --out outputs/road.mp4

# 首帧（1.5）
node <skill>/scripts/video.mjs --model grok-imagine-video-1.5 --prompt "镜头缓慢后拉" --image https://example.com/first.png --out outputs/f.mp4

# 首尾帧（1.5）
node <skill>/scripts/video.mjs --model grok-imagine-video-1.5 --prompt "从第一帧过渡到最后一帧" --image https://a.png --last-frame https://b.png --out outputs/t.mp4

# 只看将要发的 JSON
node <skill>/scripts/video.mjs --model grok-imagine-video --prompt "..." --dry-run
```

Grok 参数：`duration` 整数 1–15（不传按 8 秒计费）、`aspect_ratio` 仅 `16:9/9:16/1:1`、`resolution` 仅 `480p/720p/1080p`；图片是对象 `{"url":"https://...","type":"image_url"}`；**不要传** `seconds`、`input_reference`、`generate_audio`、`negative_prompt`、`seed`、`size`。

脚本会：创建任务 → 每 3 秒轮询 → `status` 为成功状态时下载 mp4；`failed/error/expired/cancelled` 时抛错；`progress` 停在 0 不算失败。默认最长等 10 分钟（`--timeout` 可调），超时不取消任务，可用同一 id 继续查。

若 `/models` 里出现 seedance 类模型，脚本已内置文档规则（按模型名推导时长/画幅/分辨率，`seconds` 字符串 + `duration` 整数成对发送），直接传 `--model` `--prompt` 即可，必要时用 `--seconds/--aspect/--resolution/--image`。

## 9. 报错对照

| 报错 | 处理 |
| --- | --- |
| `401 API_KEY_REQUIRED` | 没带 Authorization 头 |
| `401` | Key 无效或不属于当前分组 |
| `400 images endpoint requires an image model` | model 不是生图模型，重新挑 |
| `400 prompt: Field required` | 缺 prompt |
| `403` | 分组未开生图权限 |
| `404 async image tasks are not enabled` | 改用同步接口 |
| `404 Video request not found` | 换 Key 了，或 id 错 |
| `404 page not found` | URL 拼错（常见是重复 `/v1`） |
| `429` | 按 `Retry-After` 等待后重试 |
| `5xx` | 同一请求最多重试 2 次，不改路径 |

另：`/v1/chat/completions` 报 `not supported by the current group` 说明这把 Key 是生图/视频分组，没有聊天模型——需要用户在控制台另建聊天分组的 Key，不要反复重试。

## 10. 成本与安全

- 生图按张、视频按次或按秒计费，**文档不写单价**，让用户去控制台「模型广场」看。不要在没被要求时批量生成。
- 用户说「随便生成一张」= 允许一次低成本调用；批量/多张要先确认。
- Key 只放服务端；发现泄露提示用户去控制台禁用重建。
- 生成物默认落在 `outputs/`，交付时给出相对路径。

## 11. 参考文件

- `references/handbook.md`：完整接入手册（curl / Python / Node 示例、参数表、错误对照、计费说明），需要向用户解释接口细节时读它。
- `references/docs-原文提取.json`：从 relaycore.cn 文档站提取的原文（含视频时长/画幅推导规则、Grok 字段说明），遇到视频参数细节时查它。
