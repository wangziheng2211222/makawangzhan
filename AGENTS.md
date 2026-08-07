# AGENTS.md

## 项目概览
玛卡小镇（MAKAPLANET）官网：滚动驱动的视频旅程单页应用。用户在微信内打开，逐章节观看视频认识四位精灵伙伴（啾咔、小恶魔、机车兔、屁屁），底部 CTA 跳转腾讯文档表单。

- 技术栈：Next.js 16（App Router，webpack 模式）、React 19、TypeScript 5、CSS Modules
- 来源：github.com/wangziheng2211222/makawangzhan v2 分支
- 包管理器：pnpm（禁用 npm/yarn）

## 构建与运行
- 安装：`pnpm install`
- 预览/部署：`pnpm run build`（或 `build:preview` = install + build）+ `pnpm run start`（start 脚本内部从 `DEPLOY_RUN_PORT`/`PORT` 读端口，默认 3000）
- ⚠️ 重要：dev 模式（`next dev`）经过预览代理域名时客户端水合永不完成（无报错、React 根节点不提交，dev 专用的 eval 模块机制与代理不兼容），表现为加载进度条卡在 90%。因此预览/部署必须使用生产模式（build + start），本地直连 localhost 时 dev 模式正常
- ⚠️ .coze 的 build/run 只使用纯命令数组（如 `["pnpm","run","build"]`），不要用 `bash -c "..."` 复合命令——部署流水线无法正确解析，会在 runtime_pkg 阶段报 pnpm usage 错误
- 构建：`pnpm run build`；生产启动：`pnpm run start`
- 检查：`pnpm run typecheck`、`pnpm run lint`
- 数据校验：`pnpm run test:journey`、`pnpm run test:story-scenes`
- 端口必须从 `DEPLOY_RUN_PORT` 环境变量读取，禁止硬编码

## 目录结构
- `app/` — 路由：`page.tsx` 首页（预加载首段视频）、`admin/analytics/` 统计后台、`api/analytics/*` 埋点接口、`api/chanjing/*` 视频生成（需外部密钥）
- `components/` — `TownJourney.tsx`（主旅程，滚动驱动视频 scrub）、`JourneyVideoLayer.tsx`（视频层，blob 预加载）、`RobotChooser.tsx`、`SiteFooter.tsx`
- `data/` — `journey-media.ts`（11 段旅程视频配置）、`robots.ts`（章节与角色文案）
- `lib/` — `journey-timeline.ts`（滚动→时间轴映射）、`journey-video-state.ts`（播放状态机）、`server/analytics-store.ts`（JSONL 埋点存储）
- `public/media/journey/{desktop,mobile}/` — 24 个 MP4（桌面 61MB / 移动 31MB）；`public/images/` 海报图

## 关键机制
- 双端资源：媒体查询 `(max-width: 800px)` 判定移动端（`lib/journey-media-query.ts`），加载对应视频
- 预加载：首 3 段 fetch 完整下载后才放行加载屏；其余立即在后台顺序下载；“下一个”会等到下一可操作节点前的完整播放链全部下载后才解锁
- 视频源：桌面端用 fetch→blob→objectURL 作 `<video>` src；移动端（含微信）改用直连 URL——微信 X5/WKWebView 无法解码 blob: 视频（加载完成后黑屏、不报错）。fetch 预加载在移动端仍保留，仅用于进度/播放门禁/HTTP 缓存预热（`/media/journey/**` 已配 `Cache-Control: public, max-age=86400`，视频元素二次请求可命中缓存）
- 首帧防黑屏：首帧海报层级在视频层之上（z3，视频层 z2、文案层 z4），直到首个视频 readyState≥2 才按显示模式锁存隐藏；挂载后同步渲染首帧，不依赖 rAF（部分 WebView 首次交互前暂停 rAF）
- 微信适配：视频 muted + playsInline + x5-playsinline + x5-video-player-type="h5-page"；视口用 svh 单位；触摸手势 passive:false 控制滑动播放
- HTML 缓存：首页 `/` 在 next.config.ts 里显式覆盖为 `Cache-Control: no-cache, must-revalidate`——Next 静态页默认 `s-maxage=31536000`，不覆盖会导致 CDN/WebView 缓存长期持有旧版 HTML+JS（重新部署后手机端仍跑旧代码）。注意 `expireTime: 0` 配置无效（0 被当作未设置回退默认值），必须用 headers() 覆盖
- 静态资源文件追踪：`public/` 下的视频/图片默认不被 Next.js nft 追踪，Coze 部署 runtime_pkg 阶段会漏掉这些文件导致生产环境 404。已在 next.config.ts 配置 `outputFileTracingIncludes` 将 `./public/media/**/*` 和 `./public/images/**/*` 纳入 '/' 路由追踪。新增 public 静态资源时需确认是否被追踪
- 埋点：POST `/api/analytics/events` 仅接受 `business_cta_click`（source∈chapter/chooser/reunion + https destination + sessionId）
- 屁屁章节无 CTA 按钮：`dive-pipi` 配置 `autoAdvance: true`，播完不停顿，自动连播 connector-pipi-to-reunion → dive-reunion 直达结尾；机车兔“下一个”需等这 4 段完整下载才解锁，报名入口只保留在"进入小镇"选择层与 reunion 章节

## 环境变量
- `ANALYTICS_DATA_DIR`：埋点数据目录。未配置时开发用 `.data`，生产自动回退 `/tmp/analytics`（/tmp 非持久，可能被清理）
- `ANALYTICS_ADMIN_TOKEN`：统计后台令牌，生产未配置则 stats 接口返回 503
- `NEXT_PUBLIC_SITE_URL`：站点元数据基准 URL
- `NEXT_PUBLIC_MEDIA_*`：可将单段视频替换为 CDN 地址

## 注意事项
- 部署必须选 Web 服务（Node.js），不能静态导出（含 API 路由）
- 修改视频后需同步 `data/journey-media.ts` 并跑 `test:journey` 校验
- 移动端交互与桌面端不同（滑动触发整段播放 vs 滚动 scrub），改动时两端都要验证
