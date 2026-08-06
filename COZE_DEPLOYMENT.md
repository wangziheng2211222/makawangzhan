# 玛卡星球网站：扣子编程部署说明

本文用于将当前 MAKAPLANET 网站部署到扣子编程，并完成首页视频、加载进度、埋点接口和统计后台的上线验收。

## 1. 项目概况

- 技术栈：Next.js 16、React 19、TypeScript。
- 运行模式：Node.js 服务，不能按纯静态站点部署。
- Node.js 版本：`>= 20.9.0`，推荐使用 Node.js 22 LTS。
- 安装命令：`npm ci`。
- 构建命令：`npm run build`。
- 启动命令：`npm run start -- --hostname 0.0.0.0 --port $PORT`。
- 健康检查路径：`/`。
- 当前 Git 分支：部署时选择包含目标版本的分支；本项目当前开发分支为 `v2`。

项目的 `public` 目录当前约 159 MB，其中视频约 145 MB。桌面端和移动端各有 11 段旅程视频及 1 段结尾循环视频，共 24 个 MP4 文件。部署平台必须允许上传这些静态资源。

## 2. 部署前检查

在本地项目根目录执行：

```bash
npm ci
npm run typecheck
npm run lint
npm run test:journey
npm run build
```

以上命令全部成功后再部署。

确认旅程视频完整：

```bash
find public/media/journey -type f -name '*.mp4' | wc -l
du -sh public public/media
```

预期 MP4 数量为 `24`。如果扣子编程提示代码包或静态资源超限，应先把视频迁移到对象存储/CDN，再通过 `NEXT_PUBLIC_MEDIA_*` 环境变量引用外部地址，不要删除视频后直接发布。

## 3. 在扣子编程中创建部署

扣子编程的界面名称可能随版本调整，按下面的字段含义配置即可。

1. 新建项目或打开现有项目。
2. 选择“从 Git 仓库导入”，关联当前网站仓库。
3. 选择需要发布的分支，确认最新提交已推送。
4. 项目根目录选择仓库根目录，不要选择 `app`、`public` 或其他子目录。
5. 运行环境选择 Node.js 22；最低不能低于 Node.js 20.9。
6. 安装命令填写 `npm ci`。
7. 构建命令填写 `npm run build`。
8. 启动命令填写 `npm run start -- --hostname 0.0.0.0 --port $PORT`。
9. 健康检查路径填写 `/`。
10. 配置环境变量后发起部署。

如果扣子编程只有“静态站点”和“Web 服务”两种模式，必须选择“Web 服务”。本项目包含 `/api/analytics/events`、`/api/analytics/stats` 等 Node.js API，不能使用 `next export` 或 `out` 目录发布。

## 4. 环境变量

### 必填变量

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://example.com` | 正式访问地址，用于站点元数据和分享链接。不要以 `/` 结尾。 |
| `ANALYTICS_ADMIN_TOKEN` | 长度至少 32 位的随机字符串 | 统计后台访问令牌。禁止添加 `NEXT_PUBLIC_` 前缀。 |
| `ANALYTICS_DATA_DIR` | `/data/analytics` | 埋点 JSONL 数据目录，必须指向持久磁盘挂载点。 |

生成后台令牌：

```bash
openssl rand -hex 32
```

### 可选变量

| 变量 | 说明 |
| --- | --- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics ID，例如 `G-XXXXXXXXXX`。不使用 GA 时留空。 |
| `NEXT_PUBLIC_VIDEO_BLOB_FALLBACK` | 视频直链播放失败时是否再尝试 Blob 回退。默认不配置。 |
| `NEXT_PUBLIC_MEDIA_*` | 将单个旅程视频替换为外部 CDN 地址。未配置时使用 `public/media/journey` 中的本地文件。 |

环境变量修改后必须重新构建和部署。所有 `NEXT_PUBLIC_*` 变量会在构建阶段写入浏览器代码，不要放入任何密钥。

## 5. 埋点数据持久化

“查看详情”埋点默认写入：

```text
<ANALYTICS_DATA_DIR>/analytics-events.jsonl
```

如果扣子编程提供持久磁盘：

1. 创建持久磁盘或数据卷。
2. 挂载到例如 `/data`。
3. 设置 `ANALYTICS_DATA_DIR=/data/analytics`。
4. 重新部署后进行一次真实点击测试。
5. 重启实例，再检查统计数据是否仍然存在。

如果扣子编程不提供持久磁盘，容器重启、重新部署或扩容后 JSONL 数据可能丢失，多实例之间的数据也不会自动同步。这种情况下，正式上线前应将 `lib/server/analytics-store.ts` 改为数据库或对象存储实现。仅设置 `ANALYTICS_DATA_DIR=.data` 不能解决临时文件系统丢失问题。

统计后台地址：

```text
https://你的域名/admin/analytics
```

登录时输入 `ANALYTICS_ADMIN_TOKEN`。令牌错误返回 `401`；生产环境未配置令牌返回 `503`。

## 6. 视频与 CDN 要求

首页会先加载当前设备对应的前 8 段视频，进入页面后继续加载剩余 3 段和结尾循环视频。为保证视频拖动和加载进度正常，静态文件或外部 CDN 应满足：

- `Content-Type: video/mp4`。
- 返回准确的 `Content-Length`。
- 支持 `Accept-Ranges: bytes`。
- 不要在 CDN 节点缓冲完整响应后才一次性发送给浏览器。
- 使用版本化 URL 时，可设置长期缓存：`Cache-Control: public, max-age=31536000, immutable`。

如果使用外部 CDN，还应配置：

```text
Access-Control-Allow-Origin: https://你的正式域名
Access-Control-Expose-Headers: Content-Length, Accept-Ranges, Content-Range
```

不要使用 `Access-Control-Allow-Origin: *` 承载需要凭证的私有资源。本项目公开视频不需要 Cookie，但仍建议只允许正式站点域名。

### 进度条不动

当前加载进度依赖视频响应的 `Content-Length` 和可流式读取的响应体。如果扣子 CDN 使用 `Transfer-Encoding: chunked`、隐藏 `Content-Length`，或在边缘节点缓冲完整文件，进度可能长时间停在 0%，最后一次跳到 100%。

部署后执行：

```bash
SITE_URL=https://你的正式域名
curl -I "$SITE_URL/media/journey/desktop/dive-town.mp4"
curl -I "$SITE_URL/media/journey/mobile/dive-town.mp4"
```

至少确认响应为 `200`，并检查 `Content-Type`、`Content-Length` 和 `Accept-Ranges`。如果缺少 `Content-Length`，应调整扣子/CDN 静态资源配置，或将进度算法改为使用预先生成的媒体大小清单。

## 7. 发布后验收

### 首页

1. 使用无缓存窗口打开正式地址。
2. 加载页应立即出现，Logo、背景和百分比完整显示。
3. 百分比应持续前进；最长等待 15 秒后会进入页面。
4. 页面开放后可以正常滚动，不能继续保持页面滚动锁。
5. 快速滚动到后续角色，画面不能长时间停留在海报或出现空白。
6. 分别使用桌面横屏和手机竖屏测试，确认加载的是对应目录的视频。

### 静态资源

逐项确认以下路径返回 `200`：

```text
/images/brand/maka-planet-logo-white-cn.png
/images/scenes/story/desktop/dive-town.webp
/images/scenes/story/mobile/dive-town.webp
/media/journey/desktop/dive-town.mp4
/media/journey/mobile/dive-town.mp4
/media/journey/desktop/reunion-loop.mp4
/media/journey/mobile/reunion-loop.mp4
```

### 埋点接口

先在首页点击任意“查看详情”，再打开统计后台检查数据。也可以使用命令验证写入：

```bash
SITE_URL=https://你的正式域名
ADMIN_TOKEN=你的后台令牌

curl -i -X POST "$SITE_URL/api/analytics/events" \
  -H "Content-Type: application/json" \
  -H "Origin: $SITE_URL" \
  --data '{"event":"business_cta_click","occurredAt":"2026-08-04T00:00:00.000Z","sessionId":"deploy-check","page":"/","payload":{"cta_id":"deploy_check","cta_label":"部署验收","source":"reunion","destination":"https://mall.jd.com/"}}'

curl -i "$SITE_URL/api/analytics/stats" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

事件写入成功应返回 `202`，统计接口应返回 `200`。跨域伪造请求应返回 `403`。

### 生产环境预期行为

- `/_dev/video-tasks` 返回 `404` 是正常行为。
- `/api/chanjing/video` 在生产环境返回 `404` 是正常行为。
- 公开网站只消费已经生成的图片和视频，不会在访客浏览时提交付费生成任务。

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 构建提示 Node.js 版本不支持 | 运行环境低于 20.9 | 切换到 Node.js 22 后重新构建。 |
| 上传或构建阶段提示包体过大 | `public` 约 159 MB | 将 MP4 迁移到对象存储/CDN，并配置 `NEXT_PUBLIC_MEDIA_*`。 |
| 首页能打开但视频全部 404 | 静态视频未进入发布产物 | 检查 24 个 MP4 是否已提交、平台是否忽略大文件。 |
| 加载进度长时间不动 | CDN 不返回 `Content-Length` 或缓冲响应 | 检查视频响应头，关闭缓冲，或采用媒体大小清单。 |
| 约 15 秒后直接进入但仍显示海报 | 首批视频未在兜底时间内完成 | 检查 CDN 带宽、缓存和视频请求状态。 |
| 统计接口返回 503 | 未配置令牌或数据目录不可写 | 检查 `ANALYTICS_ADMIN_TOKEN`、持久磁盘和目录权限。 |
| 统计数据部署后消失 | 使用了临时文件系统 | 挂载持久磁盘或迁移数据库。 |
| 统计后台返回 401 | 后台令牌错误 | 使用部署环境中的 `ANALYTICS_ADMIN_TOKEN`。 |
| 埋点请求返回 403 | 访问域名与转发 Host 不一致 | 检查自定义域名、反向代理的 `Host`/`X-Forwarded-Host`。 |

## 9. 回滚

1. 在扣子编程中找到上一个成功部署版本。
2. 回滚到上一版本或重新部署上一 Git 提交。
3. 不要删除持久磁盘中的 `analytics-events.jsonl`。
4. 回滚后重新检查首页视频、埋点写入和统计后台。

本项目当前没有数据库结构迁移，代码回滚不会主动修改或删除已有 JSONL 埋点数据。
