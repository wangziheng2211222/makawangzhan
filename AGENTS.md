# 玛卡小镇 (Maka Town) - AGENTS.md

## 项目概览
玛卡小镇官方网站，展示来自玛卡星球的四位精灵伙伴角色，包含滚动式场景叙事体验、角色选择、视频播放等功能。

## 技术栈
- **Framework**: Next.js 16 (App Router, webpack 模式)
- **Core**: React 19, TypeScript 5
- **Styling**: CSS Modules
- **Icons**: lucide-react
- **Package Manager**: pnpm

## 构建与运行命令
- `pnpm install` - 安装依赖
- `pnpm build` - 构建生产版本（`pnpm install && next build --webpack`，包含依赖安装）
- `pnpm start` - 启动生产服务（`next start`）

## 目录结构

### 页面 (`app/`)
- `/` - 首页，玛卡小镇主场景体验
- `/admin/analytics` - 详情点击统计面板
- `/_dev/video-tasks` - 开发环境视频任务调试

### API 路由
- `POST /api/chanjing/video` - 蝉镜视频生成代理（开发环境）
- `GET /api/chanjing/video/tasks/[taskId]` - 视频任务状态查询
- `POST /api/analytics/events` - 记录点击事件
- `GET /api/analytics/stats` - 获取统计数据

### 核心组件 (`components/`)
- `HomeExperience.tsx` - 首页主入口，包含场景导航和角色介绍
- `TownJourney.tsx` - 滚动式场景叙事核心组件，通过 JS 驱动视差滚动效果
- `JourneyVideoLayer.tsx` - 场景视频层，支持视频加载进度条
- `RobotChooser.tsx` - 角色选择器组件
- `SiteFooter.tsx` - 网站底部

### 数据 (`data/`)
- `journey-media.ts` - 旅程场景媒体配置（背景图、视频、过渡分段）
- `robots.ts` - 角色数据（4 位精灵：Town、Jiuka、Little Devil、Biker Rabbit、Pipi）

### 工具库 (`lib/`)
- `journey-timeline.ts` - 滚动时间线计算引擎
- `chanjing.ts` - 蝉镜视频代理客户端
- `analytics.ts` / `server/analytics-store.ts` - 点击统计存储

### 类型 (`types/`)
- `robot.ts` - 角色和旅程相关类型定义
- `analytics.ts` - 统计相关类型定义

## 部署注意事项
- 使用 `production` 模式运行（`next start`），避免 Turbopack 开发模式兼容性问题
- `.coze` 配置中 run 命令使用 `${DEPLOY_RUN_PORT:-5000}` 提供端口默认值，确保部署环境变量未设置时仍能正常启动
- 构建使用 `pnpm install && next build --webpack` 合并到 `package.json` 的 build 脚本中
  - `.coze` 中 deploy build 使用 `["pnpm", "run", "build"]` 简单数组格式，避免 shell 展开问题
- run 命令使用 `node_modules/.bin/next` 替代 `npx`，避免 FaaS 环境中 npx 网络请求导致进程退出
- run 命令添加 `-H 0.0.0.0` 绑定所有网卡，确保 FaaS 环境健康检查可达

## 安全注意事项
- 蝉镜视频 API 仅在开发环境可用，生产环境返回 404
- 分析统计使用内存存储，重启后数据丢失