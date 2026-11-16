# 袋走计划 · 第一人称原型

在线试玩：<https://skyfalling-by.github.io/bag-heist/first-person/>

这是从 2D 版《袋走计划》延伸出来的单机第一人称原型：走进八间寝室，把 48 个书包按房间颜色投进中央分拣厅的 8 个桶里；秦姨会在走廊巡楼，碰到你会扣一颗心。

## 操作

- `WASD` 移动，鼠标转头，`Shift` 冲刺
- `E` 拾取 / 投袋
- `Esc` 暂停 / 释放鼠标

## 本地构建

```bash
node build.mjs
```

构建会把 Three.js 和 `src/app.js` 内联进 `src/template.html`，生成单文件 `index.html`。

## 说明

- 当前是桌面鼠标版本，手机暂未适配。
- 单机原型，暂未接入 2D 版的联机房间。
- 2D 完整版仍在仓库根目录：<https://skyfalling-by.github.io/bag-heist/>
