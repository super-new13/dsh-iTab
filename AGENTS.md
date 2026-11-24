# AGENTS.md — dsh-iTab 维护规范

本仓库是 DSH（DeepSeek Harness）Web 插件 `dsh-itab`：把会话头部的单标题换成浏览器式标签条。
用户文档在 [README.md](./README.md)，这里只写"怎么改这个项目"。

## 结构

| 位置 | 作用 |
| --- | --- |
| `src/index.js` | 宿主半（Node）：`/dsh-itab/git-branch`、`/dsh-itab/open-in-vscode` 两条路由 |
| `src/client/*.js` | 客户端半，拆成多个 part，共享一个闭包作用域 |
| `src/client.bundle.js` | **生成物**，由 `npm run build` 拼装，禁止手改 |
| `scripts/build.mjs` | 拼装脚本；part 清单与顺序在这里 |
| `src/client/i18n.js` | 界面文案字典（`zh` / `en` 两份） |
| `locale/*.json` | 市场元数据（标题、简介），不放界面文案 |
| `cordis.patch.yml` | 宿主侧激活行 |
| `dsh.plugin.json` | 插件清单（版本由 `npm version` 脚本同步） |
| `tests/` | `node --test` 用例 |

## 常用命令

```sh
npm run build   # 拼装 src/client/*.js → src/client.bundle.js
npm test        # node --test（显式文件列表，见 package.json）
npm run verify  # build + test，提交前必须全绿
npm version patch --no-git-tag-version   # 升版，version 脚本会同步 dsh.plugin.json
```

## 完成的定义（DoD）

一次改动要一起做到：

1. 改 part 源码（`src/client/*.js` 或 `src/index.js`），不改 `src/client.bundle.js`。
2. 补测试：行为变更要有用例覆盖；修 bug 先写一个能复现的失败用例。
3. `npm run verify` 全绿（先 build，`tests/bundle.test.js` 读的是构建产物）。
4. 行为 / 语义 / 配置变了 → 同步 README：功能列表、语义段落、配置表常要一起改。
5. 升版本号（`npm version patch --no-git-tag-version`，勿手改 `package.json` 与 `dsh.plugin.json` 两处）。
6. 在 GUI 里刷新自测（见「GUI 自测」）。
7. 按「提交规范」用中文提交。

纯文档改动（如本文件、README）不升版本号。

## 代码约定

- **零运行时依赖**，也不加开发期依赖；构建是纯文本拼接。
- 客户端各 part **不写 `import`**：跨文件引用走共享闭包（`P`、`ITAB_CSS` 等）。构建时统一剥掉行首 `export `，所以 part 里可以保留真实 ESM 导出，供 node 测试直接加载。
- 新增 part 要在 `scripts/build.mjs` 的 `parts` 里登记，顺序有讲究：`platform.js` 最前，`entry.js` 最后。
- 分层：状态机逻辑放 `model.js`（纯函数、可独立测试）；React / DOM 放 `strip.js`、`hooks.js`；宿主能力（git、外部打开）放 `src/index.js`。
- 持久化只经 `model.js` / `store.js` 的 helper，组件里别直接摸 `localStorage`。键名固定：`dsh.itab.tabs.v1`、`dsh.itab.history.v1`、`dsh.itab.view.v2`；改数据结构要 bump 键版本并写迁移（参考 `migrateViewStore`）。
- 偏好 store 的水合是**整体覆盖**的：`init` 默认值不会合并进已有快照，读 `prefs` 必须带兜底。
- 界面文案进 `src/client/i18n.js` 的 `zh` 与 `en` 两份字典，key 必须一致（当前各 40 条）；`locale/*.json` 只放市场元数据。
- 平台对象从 `P` 取（`P.React` / `P.E` / `P.storeKit`），且只能在工厂 `createItabPlugin()` 执行之后使用——模块顶层写 `class extends P.React.Component` 会在装配前求值成 null。
- 会话列表只在 `sessions.phase === 'ready'` 时可信：`pending` 阶段 `byId` 是空的，任何按成员关系的清理都要门控，否则冷启动会清空用户的标签。
- 标签条刻意不出现 `_tabs` 类名子串（避免命中宿主 view-nav 的 CSS 选择器）；样式集中在 `styles.js`。
- 插槽 `conversation.header.leading` 的 `priority: -1` 是刻意抢占单座（压过其他标签插件），调整前想清楚影响。
- 风格跟现有文件走：2 空格缩进、单引号、不加分号、注释用英文。没有 lint / 格式化工具，别引入。
- 改 DSH 侧 API（sessions / workspaces / uiWorkspace / 插槽 / store）前，先用 `dsh-doc` skill 查当前安装版本的文档，不要凭记忆猜。

## 测试约定

- `node:test` + `node:assert/strict`；新测试文件必须**显式加进** `package.json` 的 `test` 脚本（那里是文件列表不是 glob，漏加等于没跑）。
- `model.js` / `tooltip.js` / `gitbranch.js` / `src/index.js` 可直接 `import` 测试。
- 需要真实 hook 行为时照 `tests/hooks.test.js`：读 part 源码、剥 `export `、`vm.runInContext` 拼装，再用 React stub 同步跑 effect。
- 断言行为，不只断言实现细节；数值/阈值类断言用 README 里承诺的口径。

## 提交规范

- **提交信息一律用中文**。标题 `type: 中文主题 (版本号)`，type 取 `feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `build`；版本号括号只在升版时带。
- 正文用中文短横线，写清**改了什么、为什么、边界条件**——尤其是被否决的方案和踩到的坑，别只复述 diff。
- 一次提交一件事；生成物 `src/client.bundle.js` 与源码同一次提交，不要单独提构建产物。

示例：

```
fix: 删除当前会话时切到最后一个标签页而不是新建空白标签 (0.3.3)

- hooks.useTabSync 新增 open 回调参数：屏幕上的会话被删时不再跟随宿主
  落到新建的空白会话，而是切到最后一个存活标签并真正 open() 过去
- 重定向用模块级 fallbackFrom 去重，宿主没跳完时再触发也不会重复跳
- 删除不是"关闭"：不进关闭历史，也不会被"重新打开"带回来
```

## GUI 自测

- 本机已通过符号链接装进 Profile：`~/.dsh/profiles/desktop/node_modules/dsh-itab` → 本仓库目录。
- 插件 bundle 每次请求都会重读文件（缓存戳由 mtime / size 派生），所以 `npm run build` 后**刷新页面**即可生效，不用重启 DSH 或 Web 服务。
- 宿主 Web 要带 token 的认证 URL（`/connect?token=…` 种 cookie），agent 一般打不开裸地址 `http://127.0.0.1:53008`：界面自测交给用户刷新完成，别声称自己验证过界面。
- 涉及删除 / 关闭会话的行为，用一次性新建的会话测，别拿正在用的会话做删除测试。

## 发布

- `package.json` 的 `files` 白名单决定 npm 包内容，新增顶层文件记得加进去。
- 市场详情页截图由 `screenshots.json` 声明，图片放 `screenshots/`，README 引用同一批图。
- `engines.dsh` 必须覆盖实际验证过的 DSH 版本；验证过的版本写进 README。
