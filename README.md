# 弹无虚坑 · Trickshot Abyss

一个在浏览器里玩的弹珠肉鸽：发射弹珠打碎往下压来的敌阵，靠反弹、接球、升级和融合进化，一层层打到坑底。玩法致敬《BALL x PIT》（球比伦战记）。

> 非官方粉丝作品，与 Kenny Sun、Devolver Digital 无关。画面和音效全部由程序生成，没有使用原作的任何素材。详见 [ATTRIBUTION.md](ATTRIBUTION.md)。

## 怎么玩

| 操作 | 按键 |
|---|---|
| 移动 | WASD / 方向键 |
| 瞄准 | 鼠标（只能朝上方发射，最低 20°） |
| 发射 | 按住左键 / 空格（默认开着自动射击） |
| 自动射击开关 | F / 鼠标中键 |
| 召回卡住的球 | 右键 / R（弹珠飞出 6 秒后可用） |
| 游戏速度 | 1 / 2 / 3，或点右上角的 `>` `>>` `>>>` |
| 暂停 / 静音 | Esc / M |

手机或平板横屏也能玩：在左侧拖动是移动，在右侧按住是瞄准并射击。

- 弹珠会在墙壁、坑道顶端和敌人之间反弹。从底边飞出去的球要过一会儿才会回到手里，**用身体接住**可以立刻再发射。
- 敌人会跟着地面往下推进。靠得太近会挨近战，冲到底部的敌人也会打你一下。
- 击杀会掉经验宝石，得走过去捡。升级时三选一：新弹珠、升级弹珠、新被动、升级被动。弹珠和被动各有 4 个栏位，最高 3 级。
- 精英首领必掉彩虹色的「融合炉」，可以选择裂变、融合或进化。进化需要配方里的弹珠全部升到 3 级，比如燃烧 + 黑铁 = 炸弹。
- 每层分三段：前两段末尾各有一个精英首领，击败后坑道拓宽；最后是关底首领。
- 通关会解锁下一层、新角色、新弹珠和新被动。解锁进度存在各自的浏览器里。
- 结算时可以填名字上排行榜，标题页能看到大家的成绩。

## 现有内容

- **两层关卡**：
  - 「白骨坟场」：骷髅军团、白骨弩车两个精英，关底是骷髅王；
  - 「雪漫湾岸」：冰缚勇士、冰缚嚎叫者两个精英，关底是冰缚女王。
- **弹珠**：16 个基础弹珠和 45 种进化，任意两颗满级弹珠都能融合。
- **被动**：38 个基础被动和 8 种被动进化，包括会召唤石像士兵、金牛等友军的被动。
- **角色**：7 个，各有特性。
- **局域网排行榜**。

还没做的：其余 6 层关卡、小镇建造和局外成长、更多角色。

## 运行与部署

需要 Node.js 22 或更高版本。

```bash
npm install
npm run build    # 类型检查并构建到 dist/
npm run serve    # 在 0.0.0.0:8080 提供游戏和排行榜（PORT=xxxx 可以换端口）
```

后台常驻运行：

```bash
setsid nohup node server.mjs > server.log 2>&1 < /dev/null &
kill $(pgrep -f '^node server.mjs$')   # 停止
```

排行榜存在 `data/scores.json` 里，删掉这个文件就是清空榜单；`DATA_DIR` 环境变量可以改存放位置。

## 开发

```bash
npm run dev               # Vite 开发服务器（这个模式下没有排行榜）
npm run check             # Prettier 格式检查 + TypeScript 类型检查
npm run format            # 自动整理格式
npm run sim -- 20         # 用自动驾驶无界面跑 20 局，看胜率、用时和受伤来源
node tools/shot.ts <目录>  # 用本机 Chrome 无头跑一局并截图（需要 /usr/bin/google-chrome）
```

- 技术栈：TypeScript + Vite + Canvas 2D + Web Audio，运行时没有任何依赖。服务端只用了 Node 自带的 `http` 模块。
- `src/game/` 是纯游戏逻辑，不依赖浏览器，所以可以在 Node 里无界面运行（`tools/sim.ts`）。
- 数值在 `src/game/config.ts` 和 `src/game/data/*.ts` 里，哪些照搬原作、哪些是估算见 `docs/NOTES.md`，资料来源见 `ATTRIBUTION.md`。
- 提交规范和检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授权

- 代码：[GNU AGPL-3.0-or-later](LICENSE)。修改后发布、上架或作为在线服务提供，都必须以同样的协议公开完整源码。
- 游戏数据（`src/game/data/`）和数值说明（`docs/`）：[CC BY-SA 4.0](LICENSES/CC-BY-SA-4.0.txt)，游戏数据改编自 [BALL x PIT Wiki](https://ballxpit.wiki.gg/)。

完整的署名和来源说明见 [ATTRIBUTION.md](ATTRIBUTION.md)。
