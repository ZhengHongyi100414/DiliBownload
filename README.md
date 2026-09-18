# DiliBownload

基于 Node.js 的视频链接解析 Web 应用：扫码登录 → 解析各清晰度流地址 → 在浏览器内用 ffmpeg.wasm 合并成标准 MP4。

服务端只负责**登录态维护与地址解析**；媒体文件不落服务器磁盘，合成完全发生在你的浏览器里。

## 功能

- 扫码登录：确认后自动跟随跨域落地链，完整捕获会话凭证（解锁高清晰度与高音质轨道）
- 链接解析：支持完整 URL / BV 号 / AV 号，多分P视频逐P处理
- DownKyi 风格三下拉选择：**画质 / 编码（H.264·H.265·AV1）/ 音质（低·中·高·Dolby·Hi-Res）**
- 下载内容复选框：视频 · 音频 · 字幕 · 封面，自由组合生成直链
- **浏览器内合成**：ffmpeg.wasm（自托管，无 CDN 依赖）直接在浏览器里合并/转码，产出标准 `.mp4`
- 也可复制直链交给 IDM / aria2 / 浏览器下载（音视频分离的 DASH 轨道可用 ffmpeg 自行合并）

## 技术栈与结构

```
DiliBownload/
├── server.js            # Express 入口 + REST 路由（登录/解析/流式转发）
├── src/
│   ├── http.js          # HTTP 客户端 + Cookie jar 持久化 + 手动重定向跟随
│   ├── wbi.js           # WBI 签名（mixin key / w_rid 计算）+ 密钥提取
│   ├── buvid.js         # 游客设备指纹引导
│   ├── login.js         # 扫码登录 + 二维码 SVG 生成 + 跨域落地 cookie 捕获
│   └── video.js         # 视频元数据 + 分P + 全轨道解析（画质×编码×音质）+ 字幕
├── public/
│   ├── index.html       # 前端页面（三下拉框 + 复选框 + 浏览器合成按钮）
│   ├── app.js           # 前端逻辑（登录 / 解析 / 画质联动 / 生成链接 / 浏览器合成）
│   ├── ffmpeg-client.js # 浏览器 ffmpeg.wasm 客户端（自托管加载，经流式代理取流）
│   ├── ffmpeg-loader.js # 模块入口：把 ffmpeg-client 暴露为 window.__biliWasm
│   └── lib/             # 自托管 @ffmpeg/core（wasm ≈30MB）+ @ffmpeg/ffmpeg ESM
├── test/                # node:test + jsdom（WBI 纯函数 / 前端交互回归）
├── tools/
│   └── test-browser-wasm.mjs # 浏览器集成测试（需服务器运行 + 系统 Chrome/Edge）
└── data/                # 运行时生成：cookies.json（已 gitignore）
```

## 运行

```bash
npm install
npm start        # 默认 http://localhost:40031，可用 PORT 环境变量改端口
```

## 测试

```bash
npm test             # 纯函数 + 前端交互回归（无需服务器/浏览器）
npm run test:browser # 浏览器 ffmpeg.wasm 集成测试（先 npm start，需系统 Chrome/Edge）
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/login/qrcode` | 生成登录二维码 `{url, qrcode_key, qr_image}` |
| GET  | `/api/login/poll?qrcode_key=` | 轮询登录状态（0=成功，86101=待扫码，86090=待确认，86038=过期） |
| GET  | `/api/login/status` | 当前登录状态与账号信息 |
| POST | `/api/login/logout` | 退出登录 |
| POST | `/api/resolve` | body `{url}` → 视频信息 + 各分P画质/编码/音质轨道 + 字幕 |
| GET  | `/api/ffmpeg/proxy?url=` | 流式转发媒体给前端（带 Referer+cookie，供浏览器 ffmpeg.wasm 使用，不落盘） |
| GET  | `/api/cookies` | 导出当前会话 cookie（供外部下载工具使用） |

## 说明与限制

- **单用户/本地设计**：会话 cookie 全局共享并持久化到 `data/cookies.json`，多用户部署需按会话隔离。
- **流量路径**：解析与登录在服务端；选择浏览器合成时，媒体字节经 `/api/ffmpeg/proxy` 流式过一道服务器（CORS/Referer 所限，无法完全绕开），全程不落盘。本机部署时服务器→浏览器为回环传输，不产生额外公网流量。
- **浏览器合成**：`-c copy` 合并（保持原编码）速度快；转码模式重编码为 H.264+AAC。wasm 单 worker 堆约 2GB，分钟级 720P 实测正常；更长的视频建议复制直链用本地工具处理。
- **WebGPU**：ffmpeg.wasm 的编码器目前是纯 wasm 实现，浏览器端暂无可用的 GPU 编码后端。
- ffmpeg.wasm 核心来自 [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm)（Apache-2.0），登录与解析流程参考了 [crazysmile-PhD/downkyicore](https://github.com/crazysmile-PhD/downkyicore) 的协议实现思路。

## License

MIT