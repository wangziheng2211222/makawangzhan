# 玛卡官网 V2 当前视频衔接与预览

更新时间：2026-08-06

当前本地官网：[打开完整旅程](http://localhost:43127/)

> 下方地址直接指向官网当前实际播放的运行时视频。需要保持本地服务运行在 `http://localhost:43127`；端口变化时，只需替换链接中的端口，`/media/journey/...` 路径不变。

## 当前播放机制

- 官网按 `dive-town -> connector -> 角色 dive -> connector -> ... -> dive-reunion` 的顺序播放 11 个主视频。
- `dive-*` 是章节内容；角色段结束后停留并显示网页文案和“下一个”。用户触发后播放对应 connector，connector 结束会进入下一段 `dive-*`。
- 播放器在分段边界直接切换当前视频，没有额外白闪、黑场、深色遮罩或通用淡入淡出。连续感依赖 connector 的第一帧匹配上一段最后一帧、最后一帧匹配下一段第一帧。
- 页面文字、Logo 和按钮是独立网页图层，没有烘进视频。
- `dive-reunion` 是最终夜景章节；进入该段后，`reunion-loop` 会在开头短暂叠入并持续循环，维持夜晚小镇环境。

## 全部运行时视频

| 顺序 | 视频 | 当前内容 | 桌面端 | 移动端 |
| --- | --- | --- | --- | --- |
| 01 | `dive-town` | 从粉色星球推进、穿过粉色云层，进入白天小镇喷泉广场 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/dive-town.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/dive-town.mp4) |
| 02 | `connector-town-to-jiuka` | 从喷泉广场沿道路和星光进入啾咔的实验室 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/connector-town-to-jiuka.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/connector-town-to-jiuka.mp4) |
| 03 | `dive-jiuka` | 啾咔在黄昏实验室中观察、追随闪亮碎片 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/dive-jiuka.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/dive-jiuka.mp4) |
| 04 | `connector-jiuka-to-little-devil` | 药水瓶和紫色雾气遮挡画面，进入小恶魔的药剂房 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/connector-jiuka-to-little-devil.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/connector-jiuka-to-little-devil.mp4) |
| 05 | `dive-little-devil` | 小恶魔在镜子与药水洼前做温柔的角色动作 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/dive-little-devil.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/dive-little-devil.mp4) |
| 06 | `connector-little-devil-to-biker-rabbit` | 紫色云雾擦满镜头，再显露白天水岸追逐场景 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/connector-little-devil-to-biker-rabbit.mp4) | [预览 720x1280 / 4.04s](http://localhost:43127/media/journey/mobile/connector-little-devil-to-biker-rabbit.mp4) |
| 07 | `dive-biker-rabbit` | 机车兔在水岸街道骑车追赶小坏蛋 | [预览 1920x1080 / 5.00s](http://localhost:43127/media/journey/desktop/dive-biker-rabbit.mp4) | [预览 720x1280 / 5.00s](http://localhost:43127/media/journey/mobile/dive-biker-rabbit.mp4) |
| 08 | `connector-biker-rabbit-to-pipi` | 粉白条纹布景或幕布擦镜，进入屁屁的排练厅 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/connector-biker-rabbit-to-pipi.mp4) | [预览 720x1280 / 3.33s](http://localhost:43127/media/journey/mobile/connector-biker-rabbit-to-pipi.mp4) |
| 09 | `dive-pipi` | 屁屁对着镜子检查造型并连续摆出臭美 pose | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/dive-pipi.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/dive-pipi.mp4) |
| 10 | `connector-pipi-to-reunion` | 排练厅幕布合拢、擦镜，再打开到夜晚小镇 | [预览 1920x1080 / 5.04s](http://localhost:43127/media/journey/desktop/connector-pipi-to-reunion.mp4) | [预览 720x1280 / 5.04s](http://localhost:43127/media/journey/mobile/connector-pipi-to-reunion.mp4) |
| 11 | `dive-reunion` | 夜晚小镇全景，为居民招募文案提供最终停留画面 | [预览 1920x1080 / 6.04s](http://localhost:43127/media/journey/desktop/dive-reunion.mp4) | [预览 720x1280 / 6.04s](http://localhost:43127/media/journey/mobile/dive-reunion.mp4) |
| 12 | `reunion-loop` | 与最终夜景同构图的无缝环境循环 | [预览 1920x1080 / 6.04s](http://localhost:43127/media/journey/desktop/reunion-loop.mp4) | [预览 720x1280 / 6.04s](http://localhost:43127/media/journey/mobile/reunion-loop.mp4) |

## 五组前后衔接

### 1. 小镇 -> 啾咔

`dive-town` 最后停在四位角色围绕中央喷泉的画面。connector 从同一构图开始，跟随金色星光越过水道、道路和带星月装饰的拱门，进入黄昏实验室；最后一帧落到 `dive-jiuka` 的首帧。

- 桌面：[前段](http://localhost:43127/media/journey/desktop/dive-town.mp4) -> [连接段](http://localhost:43127/media/journey/desktop/connector-town-to-jiuka.mp4) -> [后段](http://localhost:43127/media/journey/desktop/dive-jiuka.mp4)
- 移动：[前段](http://localhost:43127/media/journey/mobile/dive-town.mp4) -> [连接段](http://localhost:43127/media/journey/mobile/connector-town-to-jiuka.mp4) -> [后段](http://localhost:43127/media/journey/mobile/dive-jiuka.mp4)

### 2. 啾咔 -> 小恶魔

`dive-jiuka` 结束在啾咔与实验台。connector 让紫色药水瓶进入近景，随后紫雾覆盖镜头，雾散后显露已经位于药剂房中的 Bobby；最后一帧落到 `dive-little-devil` 首帧。

- 桌面：[前段](http://localhost:43127/media/journey/desktop/dive-jiuka.mp4) -> [连接段](http://localhost:43127/media/journey/desktop/connector-jiuka-to-little-devil.mp4) -> [后段](http://localhost:43127/media/journey/desktop/dive-little-devil.mp4)
- 移动：[前段](http://localhost:43127/media/journey/mobile/dive-jiuka.mp4) -> [连接段](http://localhost:43127/media/journey/mobile/connector-jiuka-to-little-devil.mp4) -> [后段](http://localhost:43127/media/journey/mobile/dive-little-devil.mp4)

### 3. 小恶魔 -> 机车兔

`dive-little-devil` 结束在镜子和紫色药水洼前。connector 使用近景紫色云雾遮满画面，随后从雾中显露白天水岸与远处小镇，最终稳定到 Gee-too 骑车追赶小坏蛋的 `dive-biker-rabbit` 首帧。

- 桌面：[前段](http://localhost:43127/media/journey/desktop/dive-little-devil.mp4) -> [连接段](http://localhost:43127/media/journey/desktop/connector-little-devil-to-biker-rabbit.mp4) -> [后段](http://localhost:43127/media/journey/desktop/dive-biker-rabbit.mp4)
- 移动：[前段](http://localhost:43127/media/journey/mobile/dive-little-devil.mp4) -> [连接段](http://localhost:43127/media/journey/mobile/connector-little-devil-to-biker-rabbit.mp4) -> [后段](http://localhost:43127/media/journey/mobile/dive-biker-rabbit.mp4)

### 4. 机车兔 -> 屁屁

`dive-biker-rabbit` 结束在水岸骑行画面。connector 先让粉白条纹布景从近景擦过并完全遮挡街道，桌面端随后经过排练厅幕布，移动端直接由粉色布面揭开室内，最终落到 Pipi 与唯一镜中倒影的 `dive-pipi` 首帧。

- 桌面：[前段](http://localhost:43127/media/journey/desktop/dive-biker-rabbit.mp4) -> [连接段](http://localhost:43127/media/journey/desktop/connector-biker-rabbit-to-pipi.mp4) -> [后段](http://localhost:43127/media/journey/desktop/dive-pipi.mp4)
- 移动：[前段](http://localhost:43127/media/journey/mobile/dive-biker-rabbit.mp4) -> [连接段](http://localhost:43127/media/journey/mobile/connector-biker-rabbit-to-pipi.mp4) -> [后段](http://localhost:43127/media/journey/mobile/dive-pipi.mp4)

### 5. 屁屁 -> 夜晚小镇

`dive-pipi` 结束在 Pipi 对镜定格。connector 使用排练厅已有幕布做实体遮挡：桌面端为粉紫幕布，移动端为绿色幕布并保留亮缝；幕布重新打开后直接显露夜晚喷泉广场，落到 `dive-reunion` 首帧。进入最终章节后，`reunion-loop` 叠入并持续循环。

- 桌面：[前段](http://localhost:43127/media/journey/desktop/dive-pipi.mp4) -> [连接段](http://localhost:43127/media/journey/desktop/connector-pipi-to-reunion.mp4) -> [夜景](http://localhost:43127/media/journey/desktop/dive-reunion.mp4) -> [循环](http://localhost:43127/media/journey/desktop/reunion-loop.mp4)
- 移动：[前段](http://localhost:43127/media/journey/mobile/dive-pipi.mp4) -> [连接段](http://localhost:43127/media/journey/mobile/connector-pipi-to-reunion.mp4) -> [夜景](http://localhost:43127/media/journey/mobile/dive-reunion.mp4) -> [循环](http://localhost:43127/media/journey/mobile/reunion-loop.mp4)

## 当前需要注意的地方

- 桌面端 12 个视频均为 `1920x1080`，移动端 12 个视频均为 `720x1280`。
- 当前 `啾咔 -> 小恶魔` 和 `小恶魔 -> 机车兔` 都依赖紫雾覆盖。它们是当前运行时实际画面，但与最新“禁止雾气凭空生长”的生成策略存在冲突；以后返工时应改为边界中已经存在的实体前景遮挡。
- 当前桌面端五组首尾构图都连续。移动端已统一为 720P，不再存在相邻视频的 1080P/720P 切换。
- 替换任何角色 `dive-*` 后，都必须同时复核它前后的 connector。例如替换 `dive-pipi`，需要一起检查 `connector-biker-rabbit-to-pipi -> dive-pipi -> connector-pipi-to-reunion`。
