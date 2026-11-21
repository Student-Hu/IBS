# dsh-library · 选书插件（dsh-book-select）

把 `doc/` 里的 n8n「图书馆图书采购筛选」工作流搬成 [DeepSeek Harness](https://github.com/deepseek-ai) 插件：**阶段一**用确定性硬规则预过滤（不花模型调用），**阶段二**把剩下的书分批交给大模型，按分类号规则与内容排除规则判定「通过 / 排除 / 待复审」；结果可人工改判、可导出 CSV、能看历史存档，还能就规则本身与实现设计直接提问。

> 插件本体：`plugins/dsh-book-select/`（包名 `dsh-book-select`，零第三方运行时依赖）。

## 快速开始

```bash
# 1. 安装（tarball，装进去是独立副本）
dsh plugin --profile <你的 profile> add <绝对路径>/dist/dsh-book-select-0.1.3.tgz

# 2. 重启 DSH，浏览器硬刷新（Ctrl+Shift+R）
# 3. 左侧边栏出现「选书」图标 → 导入 Excel 征订明细 → 点「开始 AI 判定」
```

详细安装说明（产物清单、SHA-256 校验、三种安装方式、卸载换装、排错）见 [`dist/INSTALL.md`](dist/INSTALL.md)。

## 目录结构

```
.
├── plugins/dsh-book-select/     # 插件本体
│   ├── index.js                 # Host 侧：HTTP 路由 /book-select/api、agent 工具 book_select
│   ├── client.js                # 浏览器侧：侧边栏面板 + 主视图（无 JSX，手写 h()）
│   ├── lib/rules.js             # 硬规则 + AI 提示词（AI_RULES 原文照搬）
│   ├── lib/parse.js             # xlsx / csv / tsv / json 解析、表头别名、示例数据
│   ├── lib/screening.js         # 模型调用、JSON 解析容错、批内拆批重试、限流退避
│   ├── lib/scheduler.js         # 批次池与共享冷却闸（并发判定）
│   ├── cordis.patch.yml         # 插件树挂载补丁
│   ├── locale/{zh,en}.json      # 界面词典
│   └── test/                    # node:test 单元测试（不入 npm 包）
├── doc/                         # 工作流来源与设计文档
│   ├── 图书馆图书采购筛选工作流-new.json   # 原始 n8n 工作流
│   ├── extracted/               # 从工作流拆出的节点代码片段
│   ├── 征订记录RT2602-S-导出明细.xlsx      # 真实书单（示例数据）
│   ├── design/2026-11-19-parallel-screening-design.md
│   ├── plans/2026-11-19-parallel-screening-plan.md
│   └── model-return-flow.{svg,png,gen.mjs} # 模型返回处理流程图
├── dist/                        # 可分发的安装产物（tgz / 源码 zip / INSTALL.md）
└── backup/                      # 上一版本备份包
```

## 功能要点

- **两级筛选**：硬规则（页码、定价、影印版、I 类白名单、敏感词）先过一遍，剩下的才调模型，规则编号与工作流原文一致。
- **可并发的模型判定**：同一阶段内默认同时判 3 批（界面「每批」旁的「并发」下拉，1–6 可调），撞限流自动退避重试同一批而不是判失败；中途取消时在途批次保持「待判定」。
- **不重复判定**：再次点「开始 AI 判定」只处理「待判定」的书；模型调用失败的落独立「失败」桶，待判定清空后可一键重试。
- **可追溯**：每次导入与每批判定都会落盘到 `$DSH_HOME/book-select/history/`，界面上「历史」面板可回看并改判。
- **可导出**：导出的 CSV 保留导入时的**全部原始列**，再追加状态、判定依据、来源。
- **可提问**：就规则口径、状态机、参数与实现设计向插件提问（`book_select` 工具的 `ask` 动作）。
- **给 agent 用**：`book_select` 工具暴露给会话里的 agent，可导入、判定、改判、查规则、查历史。

## 开发

```bash
cd plugins/dsh-book-select
node --test          # 19 个单元测试
node --check client.js   # 语法检查
```

改完 `client.js` 后要在 DSH 的「插件」面板里把 `dsh-book-select` 条目停用再启用，浏览器刷新后才会加载新字节。

打包（产物落到 `dist/`）：

```bash
cd plugins/dsh-book-select
npm pack --pack-destination ../../dist
```

## 规则口径说明

规则与原工作流的差异都是有意为之，详见 [`plugins/dsh-book-select/README.md`](plugins/dsh-book-select/README.md) 的「规则从哪来」。要点：敏感词命中只作「预筛提示」交给模型判断、不直接排除；缺页码不猜、按通过处理并标注；模型漏判的书一律落「待复审」，不静默丢弃。

## 数据与授权

- 插件代码以 MIT 许可发布（见 `plugins/dsh-book-select/LICENSE`）。
- `doc/` 下的 `.xlsx` / `.csv` 是选书流程的**样例与实测数据**，来自工作流原始需求方，用于复现与回归；如需替换为脱敏数据，直接覆盖同名文件即可。
- 插件运行时的判定结果与历史存档写在**你自己的** `$DSH_HOME/book-select/` 下，不随本仓库分发。
