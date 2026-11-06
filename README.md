# DSH 样式

[![npm](https://img.shields.io/npm/v/dsh-style-wallpaper.svg)](https://www.npmjs.com/package/dsh-style-wallpaper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 换个样子：左上角的名字和图标可以自己换，整个窗口还能铺一张背景图（GIF / WebP 动图也行）。

## 功能

| 想改的 | 说明 |
| --- | --- |
| **应用名称** | 左上角显示的文字，留空就用默认名字 |
| **应用图标** | 替换左上角那条小鲸鱼，PNG / JPG / WebP / GIF / SVG，≤ 2 MB |
| **背景图** | 铺满整个窗口，图片和动图都可以，≤ 32 MB |
| **背景遮罩** | 0–85% 的滑杆，背景花的时候往右拉，字就清楚了 |

设置都放在 设置 → **DSH 样式** 里（排在「Agent 预设」和「桌宠配置」之间），改完立刻生效，不用重启。

清空名字或图标会恢复默认外观 —— 只有在设置了值的时候，插件才会占用左上角那两格。

## 安装

这个包没有依赖、没有构建步骤、没有安装脚本，装完就能跑。

**从 npm 装（推荐）**

侧边栏 → **插件** → 安装，填 `dsh-style-wallpaper`；或者命令行：

```bash
dsh plugin --profile <profile 名> add dsh-style-wallpaper
```

从 npm 装的包，插件页能检查并安装更新。

**从 GitHub 装**

同一个地方填 `github:shshy250/dsh-style`，或者直接对 agent 说「装 `github:shshy250/dsh-style`」。

> 装 GitHub 地址时，插件管理器会先 `git ls-remote` 探一下仓库，网络不通会直接报错、不会装到一半。

装完刷新一下页面（或重启 DSH），设置里就会出现「DSH 样式」。

## 数据存在哪

```
~/.dsh/storages/dsh-style/
├── state.json          # 名字、遮罩值、当前用的图片
└── logo-<hash>.png     # 上传的图标 / 背景图，按内容哈希命名
```

不写进 profile 的 `cordis.patch.yml`，所以升级、重装插件都不会丢。删掉这个目录就完全回到初始状态。

## 兼容性

- 在 **DSH 0.2.2-rc.1 桌面版（Windows）** 上开发和测试。
- 依赖这几个界面位置：`sidebar.brand.mark`、`sidebar.brand.name`、`settings.section`、`settings.section.icon`。更老的 DSH 如果没有这些位置，设置页不会出现，改名换图标也不会生效。
- 纯 JavaScript + CSS，没有平台分支，理论上 macOS / Linux 一样能跑（未实测）。

## 已知限制

- **不支持视频。** 不是偷懒：DSH 的界面里没有能放在内容「后面」的图层，video 塞进去只会盖住整个应用。动图走 CSS 背景，所以 GIF / WebP 可以正常动。
- 背景的做法是把应用的基础底色变透明透出来的，所以原本用基础底色画的面板也会一起变透。觉得不好看就把「背景遮罩」调大。
- 侧栏的半透明底色写死了浅色 / 深色两套，换自定义主题时可能不太贴。
- 图标上限 2 MB、背景上限 32 MB；格式按文件内容判断，改扩展名蒙不过去。

## 卸载

插件页里移除这个 bundle 就行。数据目录不会自动删，想清干净手动删掉 `~/.dsh/storages/dsh-style/`。

## 实现

```
.
├── index.js           # 宿主侧：一个前缀路由，读写 state.json 和上传的图片
├── client.js          # 浏览器侧：注册设置页和左上角插槽，注入背景样式
├── cordis.patch.yml   # bundle 入口（insert 一行）
├── locale/            # 插件名和描述的本地化
└── icon.svg           # 插件图标
```

宿主侧只做一件事：在 `/dsh-style` 下提供 `GET /state`、`PUT /name`、`PUT /options`、`POST|DELETE /media`、`GET /asset/<file>`，图片字节和状态都落在 `~/.dsh/storages/dsh-style/`。

浏览器侧做三件事：

1. 用 `settings.section` 注册「DSH 样式」页，读写都走上面那个路由；
2. 用 `settings.section.icon` 给它一个导航图标；
3. 名字和图标分别注册到 `sidebar.brand.name` / `sidebar.brand.mark`，优先级比内置品牌位低一档，所以只在有值的时候盖住它，清空后自动让位。

背景是一条注入到 `<head>` 的样式（`body` 的背景图 + 遮罩渐变），再通过 `ctx.theme.overrideTokens` 把 `--dsw-alias-bg-base` 调成透明、把侧栏底色调成半透明 —— 只动主题 token，不碰别人的 DOM。

## License

[MIT](./LICENSE)
