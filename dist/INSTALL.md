# dsh-book-select 安装说明

图书馆中文图书采购的选书工作台插件：硬规则预过滤 + 大模型判定 + 人工改判 + 导出 + 规则/设计问答。

版本说明：

- **0.1.8**：新增**导出 Excel**——除 CSV 外多一个「导出 Excel」按钮，导出当前视图的真 `.xlsx` 文件（不是改名的 CSV）：表头加粗冻结、首行带筛选器、列宽按内容估算、价格等数字写成数值，可以直接排序筛选，也能再导入回来；内容与 CSV 完全一致。
- **0.1.7**：导出按钮旁写明当前导出的是什么——状态标签 + 本数（带搜索词时再加命中说明），例如「导出 通过 5 本（搜索「教材」命中）」，不用猜。
- **0.1.6**：修掉导出 CSV 的多余选项——去掉「导出范围」下拉，导出直接跟随当前视图：顶部状态标签选哪个就导出哪一批（全部/通过/失败…），搜索框命中的也一起导出。
- **0.1.5**：书目表最后新增**批注**列——给每本书写自己的判断描述（可拖高、失焦或 Ctrl+Enter 保存）；批注随历史存档留存、导出 CSV 时作为追加列输出，也能用搜索框搜到；批注不影响任何规则判定。
- **0.1.4**：新增**批次监控**——判定时能看到每一批在做什么（调用模型 / 解析返回 / 限流退避 / 拆批重试 / 写回判定）、跑了多久、各批的通过·排除·待复审计数，以及本轮与每批的 token 用量；跑完这份报告随历史存档一起留存。
- **0.1.3**：判定可并发——同一阶段内默认同时判 3 批（界面「每批」旁边多了「并发」下拉，1–6 可调），撞限流时该批自动退避重试同一批而不是判失败；取消时在途批次保持「待判定」；判定依据与改判说明完整显示。
- **0.1.2**：书目表列宽调整——书名收窄到 200px（仍两行截断、点开可展开），判定依据 / 改判列改为吃满剩余宽度。
- **0.1.1**：单批模型调用失败不再混进「待复审」，改落独立的「失败」桶，并在「待判定」清空后自动重试；判定依据与改判说明改为完整显示、不再两行截断。

## 产物

| 文件 | 用途 |
| --- | --- |
| `dsh-book-select-0.1.8.tgz` | npm 风格 tarball，**推荐**：装进去的是独立副本 |
| `dsh-book-select-0.1.8-source.zip` | 源码，解压成目录后安装（装进去是链接依赖，改源码即时生效） |

两个包的内容完全相同（`index.js` / `client.js` / `lib/*`（含 `lib/xlsx.js`）/ `cordis.patch.yml` / `locale/*` / `icon.svg` / `LICENSE` / `README.md` / `package.json`，共 14 个文件）。插件本体零第三方运行时依赖。

校验（SHA-256）：

```
3f10c0daa804fd41646f24d5d97aedb40ea161301f68b781402897c5c1d714a5  dsh-book-select-0.1.8.tgz
70518513114eb9edbaadae801b9eab900baa9764c3a5f03e4d1dd193091e1332  dsh-book-select-0.1.8-source.zip
```

Windows 下可核对：`Get-FileHash <文件> -Algorithm SHA256`。

## 前置条件

- Node.js ≥ 20
- DeepSeek Harness（DSH）≥ 0.2.0
- DSH 里已配好模型并选定当前会话所用模型（判定环节要调用大模型）

## 安装 tarball

```bash
dsh plugin --profile <你的 profile> add <绝对路径>/dsh-book-select-0.1.8.tgz
```

或在 GUI「插件」面板里把 tarball 的**绝对路径**填进安装框（路径必须是绝对路径，相对路径会被拒绝）。

DSH 会执行 `pnpm add file:<绝对路径>`，并自动把本包追加进 profile 的 `dsh.profile.bundles`、加载它的 `cordis.patch.yml`——**不需要手改 profile 的 patch 文件**。若 DSH 版本低于 `engines.dsh` 声明的版本而被拒绝，可用：

```bash
dsh plugin --profile <你的 profile> allow-version dsh-book-select@0.1.8 --dsh-version <你的 DSH 版本> --accept-risk
```

## 安装源码目录

解压 `dsh-book-select-0.1.8-source.zip` 得到 `dsh-book-select/` 目录，然后：

```bash
dsh plugin --profile <你的 profile> add <绝对路径>/dsh-book-select
```

## 从 Git 仓库安装

```bash
dsh plugin --profile <你的 profile> add github:<账号>/<仓库>
```

## 装完之后

1. 重启 DSH（`pm2 restart dsh-web` 或手动重启），浏览器硬刷新（Ctrl+Shift+R）。
2. 左侧边栏出现 **选书** 图标，点开就是选书工作台。
3. 导入 Excel 征订明细 → 点「开始 AI 判定」→ 看结果 → 导出 CSV / 查历史 / 看规则 / 问设计问题。
4. 想更快：「每批」右边有「并发」下拉（默认 3 路，1–6 可调）。同一阶段内多批同时判定，token 花费不变，只缩短总耗时；撞到 provider 限流会自动退避重试同一批。
5. 想看清过程：进度条旁的「批次监控」按钮展开后，能看到每一批在做什么、跑了多久、三桶计数与 token 用量；跑完这份报告随历史存档留存。
6. 想写自己的判断：书目表最后一列是「批注」，直接输入，失焦或 Ctrl+Enter 保存；批注会随存档留存、导出 CSV 时一并输出，不影响任何规则判定。
7. 导出按当前视图来：顶部状态标签选「全部」就导出全部、选「通过」就导出通过的、选「失败」就导出失败的；搜索框命中的也一起导出。按钮旁写着这次导出的是什么，例如「导出 通过 5 本（搜索「教材」命中）」。
8. 要 Excel 就点「导出 Excel」：拿到的是真 `.xlsx`（表头加粗冻结、首行筛选器、数字是数值），可直接在 Excel 里排序筛选，也能再导入插件；内容与「导出 CSV」一致。

## 卸载 / 换装

```bash
dsh plugin --profile <你的 profile> remove dsh-book-select
```

或在 GUI「插件」面板里卸载 `dsh-book-select`。**同名包必须先卸载再装**（否则报 `already-installed`），例如从 tarball 换成源码目录方式：先 remove，再 add 新路径，然后重启 DSH。

## 排错

- **侧边栏没有「选书」图标**：插件条目没激活。到「插件」面板看 `dsh-book-select` 条目状态；Host 侧若报 `cannot get property "tools" without inject`，说明 Host 端 `inject` 声明被改动过——它必须包含 `webServer`、`tools`、`connection`、`llm`、`agentDefaultModel`。
- **「开始 AI 判定」提示缺少模型**：先在 DSH 里选好当前会话的模型。
- **安装时报 `already-installed`**：profile 里已经装过同名包，先在「插件」面板里卸载再装。
- **安装报 `incompatible-version`**：见上面的 `allow-version` 命令。
