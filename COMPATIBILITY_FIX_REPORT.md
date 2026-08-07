# 微信 / 钉钉兼容性修复报告

> 玛卡小镇（MAKAPLANET）官网 · v2 分支代码复查 · 2026-08-07

---

## 一、背景与范围

针对微信（iOS WKWebView / Android X5）与钉钉（iOS WKWebView / Android UC）四类内置浏览器环境，依据既有记录 `COMPATIBILITY.md` 对当前代码库做回归核对，并扫描修复后新引入代码的兼容性风险。

## 二、回归核对结论：原有修复全部在位，无回退

| # | 核对项 | 位置 | 结果 |
|---|--------|------|:--:|
| 1 | GA 使用 `googletagmanager.cn` 域名 | `app/layout.tsx:43` | ✅ |
| 2 | WebView meta 三件套 | `app/layout.tsx:32-36` | ✅ |
| 3 | `color-mix()` fallback（`.copy::before`） | `TownJourney.module.css:272` | ✅ |
| 4 | `backdrop-filter` fallback ×3 | `TownJourney.module.css:373/500/708` | ✅ |
| 5 | `overscroll-behavior: none` 防下拉刷新 | `globals.css:30` 等两处 | ✅ |
| 6 | `sendBeacon` 加固降级链 | `lib/analytics.ts:57-63` | ✅ |
| 7 | `randomUUID` / `sessionStorage` fallback | `lib/analytics.ts:21-41` | ✅ |
| 8 | x5/inline 视频播放属性 | `JourneyVideoLayer.tsx:55-60` | ✅ |
| 9 | blob URL 降级直连 | `JourneyVideoLayer.tsx:116-138` | ✅ |
| 10 | 视频 `ended` 事件 polling 兜底 | `TownJourney.tsx:925-930` | ✅ |
| 11 | 钉钉 rAF → setTimeout | `TownJourney.tsx:694-697` | ✅ |
| 12 | `visibilitychange` + `pagehide` 管理 | `TownJourney.tsx:1442-1446` | ✅ |
| 13 | `svh` + `vh` fallback ×3 | `TownJourney.module.css` | ✅ |

## 三、本轮新发现并修复（3 项）

| # | 严重度 | 问题 | 影响 | 修复方案 |
|---|:--:|------|------|----------|
| 1 | 🟡 中等 | `.loadingLogo` 依赖 `aspect-ratio`（iOS 15+） | iOS 14.x 下加载屏 Logo 高度塌陷为 0，品牌 Logo 不可见 | 增加 `min-height: min(25vw, 102px)` 兜底，支持 `aspect-ratio` 的浏览器行为不变 |
| 2 | 🟢 轻微 | `RobotChooser` `.imageFrame` 的 `color-mix()` 无 fallback | X5（Chromium ≤110）/ UC 下精灵卡片图片底色变浅，装饰性影响 | 按既有模式补纯色 fallback 声明 |
| 3 | 🟢 轻微 | `globals.css` 使用独立 `scale` 属性（Chrome 104+） | 老 X5/UC 下按钮/链接按压反馈失效 | 改为全内核支持的 `transform: scale(0.98)` |

## 四、记录在案、暂不修复（可接受风险）

- **`inset` 简写**：仅 iOS 14.0 不支持（14.1+ 起支持），全面展开为 `top/right/bottom/left` 改动面大、回归风险高于收益
- **`text-wrap: balance`**：不支持的浏览器静默忽略，回退普通换行
- **`content-visibility` / `contain-intrinsic-size`**：仅 Chromium 生效的性能提示，其他内核忽略无副作用

## 五、验证结果

| 验证项 | 结果 |
|--------|------|
| 服务探活 `localhost:5000` | ✅ ready |
| 埋点写入 `POST /api/analytics/events` | ✅ `202 {"accepted":true}` |
| 运行日志（app.log / console.log） | ✅ 无异常错误 |
| `GET /api/analytics/stats` 返回 503 | ⚠️ 设计行为：生产环境未配置 `ANALYTICS_ADMIN_TOKEN` 时的安全保护（`stats/route.ts:19`），非本次改动引入，与客户端兼容性无关 |

## 六、变更文件清单

1. `components/TownJourney.module.css` — 加载屏 Logo 高度兜底
2. `components/RobotChooser.module.css` — `color-mix()` 纯色 fallback
3. `app/globals.css` — `scale` → `transform: scale()`
4. `COMPATIBILITY.md` — 新增第八章"复查记录"（核对表 + 新修复项 + 风险清单）

## 七、后续建议

代码层面微信/钉钉兼容性已闭环，剩余为真机验证：微信扫码 + 钉钉扫码，iOS / Android 各一台，重点跑通"加载屏 → 进入小镇 → 滑动浏览四位精灵 → CTA 跳转腾讯文档"全链路，并覆盖弱网预加载与切后台恢复两个边界场景。
