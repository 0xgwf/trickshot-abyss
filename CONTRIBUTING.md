# 参与开发

## 开始

```bash
npm install      # 会顺便启用 .githooks 里的提交检查
npm run dev      # http://localhost:5173
```

## 提交前会自动检查

- `pre-commit`：运行 `npm run check`，也就是 Prettier 格式检查加 TypeScript 类型检查。不通过就无法提交，可以先用 `npm run format` 自动整理格式。
- `commit-msg`：检查提交信息是否符合 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式。

## 提交信息

格式为 `类型: 一句话说明`，必要时空一行再写正文，说明为什么要这么改：

```
feat: 新增第三层「间隙沙漠」
fix: 冰冻的猛兽不再继续冲锋
docs: 补充数据来源署名
refactor: 关卡数据改为配置驱动
```

常用类型：`feat`（新功能）、`fix`（修复）、`docs`（文档）、`refactor`（重构）、`perf`（性能）、`test`（测试）、`build` / `ci` / `chore`（构建、CI、杂项）。

一次提交只做一件事。新功能在分支上开发，合并时用 Squash and merge，让 `main` 上一个功能对应一条提交。

## 改数值或加内容时

- 游戏数据放在 `src/game/data/`，以 CC BY-SA 4.0 发布。新增内容如果参考了 wiki 等资料，请在 [ATTRIBUTION.md](ATTRIBUTION.md) 里补上来源；自己估算的数值请记到 [docs/NOTES.md](docs/NOTES.md)。
- 改完跑一下 `npm test` 和 `npm run stress`，再用 `npm run sim -- 12` 看胜率和有没有报错。`sim` 的参数依次是 `[局数] [角色] [none|boneyard|snowy] [full|boss] [关卡] [起始种子]`。
- 新加弹珠或被动时，`npm run stress` 会自动把它放上场跑；卡面文字里写了具体数值的效果，最好在 `test/` 里补一条测试。
- 不要提交原作的任何美术、音频或代码。

## 授权

提交代码即表示你同意将其以 [AGPL-3.0-or-later](LICENSE) 发布；提交到 `src/game/data/` 和 `docs/` 的内容则以 [CC BY-SA 4.0](LICENSES/CC-BY-SA-4.0.txt) 发布。
