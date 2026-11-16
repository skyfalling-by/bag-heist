# 袋走计划 / BAG HEIST

八人合作搬包小游戏。48 个书包散落在 8 间寝室，按颜色和编号投进中央分拣厅的 8 个桶；监管者一次锁一个人，队友要捡起发光的铃铛包抢仇恨救人。

## 在线玩

https://skyfalling-by.github.io/bag-heist/

- 单机：你 + 7 名 AI 学生 + 1 名 AI 监管者。
- 联机：2–4 名真人，房间码加入，其余位置由 AI 补足；房主保持页面在前台。

## 本地开发

```bash
node build.mjs
```

构建会把 `src/style.css`、`src/game.js`、`src/net.js` 和 `src/peerjs.min.js` 内联进 `src/template.html`，输出根目录的单文件 `index.html`。

## 文件

- `index.html` — 构建后的单文件游戏
- `build.mjs` — 无依赖构建脚本
- `src/game.js` — 单机规则、地图、AI、渲染和 UI
- `src/net.js` — PeerJS 房间码联机（房主权威模拟）
- `src/style.css` — 纸张夜班主题
- `src/template.html` — 页面骨架
- `src/peerjs.min.js` — PeerJS 1.5.4

## 操作

WASD / 方向键移动，Shift 冲刺，空格 / E 投袋，P / Esc 暂停。手机横屏可用触屏摇杆和按钮。
