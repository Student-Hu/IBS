/**
 * Book-selection workbench — browser half.
 *
 * Registers the sidebar icon (`sidebar.panellist`) and the workbench page it
 * switches to (`main`, key `book-select`), and talks to the Host through
 * `/book-select/api/*` (the same-origin JSON route the Host half mounts). Menu
 * text comes from the dictionaries below; surfaces and text colours come from
 * the shipped `--dsw-alias-*` tokens plus local tints derived from them, so the
 * page follows the active light/dark theme.
 */

window.__ModuleLoader__.load({
  id: 'dsh-book-select',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-book-select'

    /** Chinese dictionary — the language of the acquisition rules themselves. */
    const zh = {
      viewLabel: '选书',
      title: '选书工作台',
      tagline: '硬规则预过滤 + 大模型判定',
      intro: '导入征订书目后先按硬规则排除，再由大模型按分类号与内容规则判定「通过 / 排除 / 待复审」。',
      sample: '载入示例',
      reset: '清空',
      tabData: '导入与判定',
      tabRules: '规则说明',
      tabQa: '设计问答',
      importTitle: '导入征订书目',
      importHint: '选一个 Excel 征订明细（.xlsx）即可；导入后立刻用确定性规则预过滤，敏感词只作提示交给模型。也支持 .csv / .tsv / .txt / .json。',
      pickFile: '选择文件',
      pickFileShort: '导入书目',
      pickFileHint: '点这里选 .xlsx（默认）/ .csv，导入后立即预过滤',
      importing: '解析中…',
      loading: '加载中…',
      historyButton: '历史',
      historyTitle: '历史选书记录',
      historyHint: '每次导入和每批判定后自动保存，最多保留 40 份',
      historyClose: '返回书目',
      historyEmpty: '还没有历史记录',
      historyEmptyBody: '导入一份征订明细并判定后，这里会出现带结果的存档，随时可以载入查看。',
      historyLoad: '载入',
      historyDelete: '删除',
      historyUntitled: '未命名导入',
      run: '开始 AI 判定',
      running: '判定中…',
      cancel: '取消',
      batch: '每批',
      concurrency: '并发',
      concurrencyUnit: '路',
      booksUnit: '本',
      model: '模型',
      progress: '已判定',
      failed: '失败',
      retryFailed: '重试失败书目',
      phaseRetry: '重试失败',
      batches: '批',
      batchMonitor: '批次监控',
      batchMonitorHint: '每批在做什么、耗时多久、花了多少 token',
      runningBatches: '{count} 批在跑',
      batchNoLabel: '批',
      stageCalling: '调用模型中',
      stageParsing: '解析返回',
      stageCooling: '限流退避 {seconds} 秒后重试',
      stageSplitting: '拆批重试',
      stageApplying: '写回判定',
      elapsedLabel: '已耗时',
      avgPerBatch: '平均 {seconds} 秒/批',
      slowestBatch: '最慢 {no} 批 {seconds} 秒',
      finishedBatches: '已完成 {count} 批',
      noBatchRecords: '还没有批次记录',
      showAllBatches: '展开全部 {count} 批',
      showFewerBatches: '只看最近 {count} 批',
      tokenTitle: '本轮 token',
      tokenIn: '输入',
      tokenOut: '输出',
      tokenTotal: '合计',
      tokenPerBook: '平均 {value}/本',
      tokenFixedPrompt: '每批固定规则提示 ≈ {value} 输入',
      batchDone: '完成',
      batchFailed: '失败',
      batchCancelled: '已取消',
      statTotal: '总书目',
      statPassed: '通过',
      statRejected: '排除',
      statReview: '待复审',
      statPending: '待判定',
      statFailed: '失败',
      filterAll: '全部',
      search: '搜索书名、出版社、分类号或判定依据',
      export: '导出 CSV',
      exportScope: '导出范围',
      scopeAll: '全部书目',
      scopePassed: '仅通过的',
      colNo: '序号',
      colTitle: '书名',
      colPublisher: '出版社',
      colCls: '分类号',
      colPrice: '价格',
      colPages: '页码',
      colStatus: '状态',
      colReason: '判定依据 / 改判',
      colSource: '判定来源',
      colAuthor: '责任者',
      colYear: '出版年',
      detailOpen: '展开内容简介',
      detailClose: '收起',
      detailSummary: '内容简介',
      detailHint: '敏感词提示',
      detailIsbn: 'ISBN',
      detailEdition: '版次',
      pageNote: '页码为空或不是“N 页”格式的记录按原规则放行（不猜页码）；显示「—」表示原表没有该字段。',
      keywordNote: '敏感词只作提示、不再直接排除：命中词会随书目一起交给模型，由模型按内容判断。',
      statusPending: '待判定',
      statusPassed: '通过',
      statusRejected: '排除',
      statusReview: '待复审',
      statusFailed: '失败',
      sourceRule: '硬规则',
      sourceAi: '大模型',
      sourceManual: '人工',
      pageInfo: '第 {page} / {total} 页',
      pagePrev: '上一页',
      pageNext: '下一页',
      pageFirst: '首页',
      pageLast: '末页',
      pageSize: '每页',
      pageUnit: '条',
      pageTotal: '共 {count} 条',
      emptyTitle: '没有匹配的书目',
      emptyFiltered: '清除筛选，或换个搜索词试试。',
      rulesPrefilter: '阶段一 · 硬规则预过滤（不调用模型）',
      rulesPrefilterHint: '按顺序执行，首个命中即排除；其中页码、价格、影印、I 类四条会直接进入「排除」，敏感词只作提示随书交给模型判断。右侧数字是本次数据的命中数。',
      rulesHits: '命中',
      rulesClass: '阶段二 · 分类号内容规则',
      rulesContent: '阶段二 · 内容排除规则（命中任意一条即排除）',
      rulesKeywords: '敏感词提示表（仅提示，不直接排除）',
      rulesWhitelist: 'I 类出版社白名单',
      rulesOutput: '模型输出契约',
      rulesOutputBody: '{"passed": [], "rejected": [], "review": []} — passed 记「通过理由」，rejected 记「规则第X条 + 具体依据」，review 记「待复审原因」。每本书必须且只能落在一个数组里；模型漏判的书自动转入待复审。',
      qaTitle: '针对规则与设计提问',
      qaHint: '回答只依据规则原文与本插件的实现说明；规则没写到的地方会直接说「规则未覆盖」，不做编造。',
      qaPlaceholder: '例如：为什么 I 类只保留这 15 家出版社？批大小调大有什么风险？',
      send: '发送',
      thinking: '思考中…',
      qaSugg1: '价格阈值 500 元与页码阈值 20 页分别在哪一步生效？',
      qaSugg2: '为什么要把「待复审」单独留一类，而不是并进通过或排除？',
      qaSugg3: '批量大小怎么选，调大之后结果会变吗？',
      qaSugg4: '如果我想再加一条内容排除规则，应该改哪里、怎么验证？',
      errPrefix: '出错：',
      askEmpty: '输入一个问题后再发送。',
    }

    /** English dictionary. */
    const en = {
      viewLabel: 'Book Select',
      title: 'Book selection workbench',
      tagline: 'hard-rule prefilter + model screening',
      intro: 'Import an acquisition list: hard rules drop the obvious cases first, then the model classifies the rest as pass / reject / review.',
      sample: 'Load sample',
      reset: 'Clear',
      tabData: 'Import & screen',
      tabRules: 'Rules',
      tabQa: 'Design Q&A',
      importTitle: 'Import acquisition records',
      importHint: 'Pick an .xlsx acquisition list and it is imported and prefiltered right away; sensitive words become hints for the model. .csv / .tsv / .txt / .json also work.',
      pickFile: 'Choose file',
      pickFileShort: 'Import',
      pickFileHint: 'Click to pick an .xlsx (default) or .csv; prefiltering runs on import',
      importing: 'Parsing…',
      loading: 'Loading…',
      historyButton: 'History',
      historyTitle: 'Saved lists',
      historyHint: 'Saved on import and after every judged batch, 40 files at most',
      historyClose: 'Back to list',
      historyEmpty: 'No saved lists yet',
      historyEmptyBody: 'Import an acquisition list and judge it; the result is archived here and can be reopened any time.',
      historyLoad: 'Open',
      historyDelete: 'Delete',
      historyUntitled: 'Untitled import',
      run: 'Run screening',
      running: 'Screening…',
      cancel: 'Cancel',
      batch: 'Batch',
      concurrency: 'Concurrency',
      concurrencyUnit: 'at once',
      booksUnit: 'books',
      model: 'Model',
      progress: 'Judged',
      failed: 'failed',
      retryFailed: 'Retry failed',
      phaseRetry: 'retrying failures',
      batches: 'batches',
      batchMonitor: 'Batch monitor',
      batchMonitorHint: 'What each batch is doing, how long it took, what it cost',
      runningBatches: '{count} running',
      batchNoLabel: 'Batch',
      stageCalling: 'Calling model',
      stageParsing: 'Parsing reply',
      stageCooling: 'Rate limited, retrying in {seconds}s',
      stageSplitting: 'Splitting batch',
      stageApplying: 'Applying verdicts',
      elapsedLabel: 'Elapsed',
      avgPerBatch: '{seconds}s per batch on average',
      slowestBatch: 'slowest batch {no}: {seconds}s',
      finishedBatches: '{count} batches done',
      noBatchRecords: 'No batches yet',
      showAllBatches: 'Show all {count} batches',
      showFewerBatches: 'Show only the last {count}',
      tokenTitle: 'Tokens this run',
      tokenIn: 'in',
      tokenOut: 'out',
      tokenTotal: 'total',
      tokenPerBook: '{value} per book',
      tokenFixedPrompt: 'fixed prompt ≈ {value} per batch',
      batchDone: 'done',
      batchFailed: 'failed',
      batchCancelled: 'cancelled',
      statTotal: 'Total',
      statPassed: 'Passed',
      statRejected: 'Rejected',
      statReview: 'Review',
      statPending: 'Pending',
      statFailed: 'Failed',
      filterAll: 'All',
      search: 'Search title, publisher, classification or evidence',
      export: 'Export CSV',
      exportScope: 'Export',
      scopeAll: 'All books',
      scopePassed: 'Passed only',
      colNo: 'No.',
      colTitle: 'Title',
      colPublisher: 'Publisher',
      colCls: 'Class',
      colPrice: 'Price',
      colPages: 'Pages',
      colStatus: 'Status',
      colReason: 'Evidence / override',
      colSource: 'Verdict by',
      colAuthor: 'Author',
      colYear: 'Year',
      detailOpen: 'Show summary',
      detailClose: 'Hide',
      detailSummary: 'Summary',
      detailHint: 'Keyword hint',
      detailIsbn: 'ISBN',
      detailEdition: 'Edition',
      pageNote: 'Records with a blank page field (or one that is not “N 页”) pass, as the original rule never guesses page counts; “—” means the source table had no such column.',
      keywordNote: 'Sensitive words are hints only: they travel with the book to the model, which judges the content instead of the word.',
      statusPending: 'Pending',
      statusPassed: 'Passed',
      statusRejected: 'Rejected',
      statusReview: 'Review',
      statusFailed: 'Failed',
      sourceRule: 'rule',
      sourceAi: 'model',
      sourceManual: 'manual',
      pageInfo: 'Page {page} of {total}',
      pagePrev: 'Previous',
      pageNext: 'Next',
      pageFirst: 'First',
      pageLast: 'Last',
      pageSize: 'Rows per page',
      pageUnit: 'rows',
      pageTotal: '{count} rows',
      emptyTitle: 'No matching books',
      emptyFiltered: 'Clear the filter or try another search term.',
      rulesPrefilter: 'Stage 1 · hard-rule prefilter (no model call)',
      rulesPrefilterHint: 'Evaluated in order; the page/price/reprint/I-class rules reject outright, while sensitive words only travel to the model as hints. The number on the right counts hits in the current list.',
      rulesHits: 'hits',
      rulesClass: 'Stage 2 · per-class rules',
      rulesContent: 'Stage 2 · content exclusions (any hit rejects)',
      rulesKeywords: 'Sensitive words (hints only)',
      rulesWhitelist: 'I-class publisher whitelist',
      rulesOutput: 'Model output contract',
      rulesOutputBody: '{"passed": [], "rejected": [], "review": []} — passed carries a reason, rejected cites “rule N + evidence”, review states the doubt. Every book must appear in exactly one list; a book the model omits becomes review.',
      qaTitle: 'Ask about the rules and the design',
      qaHint: 'Answers are grounded in the rule text and this plugin’s implementation; anything the rules do not cover is stated plainly.',
      qaPlaceholder: 'e.g. why does class I keep only those publishers? what breaks when the batch grows?',
      send: 'Send',
      thinking: 'Thinking…',
      qaSugg1: 'Where do the 500 CNY price cap and the 20-page floor act?',
      qaSugg2: 'Why keep a separate “review” bucket instead of pass or reject?',
      qaSugg3: 'How should the batch size be chosen, and does a larger batch change the verdicts?',
      qaSugg4: 'Where do I add another content exclusion rule, and how do I verify it?',
      errPrefix: 'Error: ',
      askEmpty: 'Type a question first.',
    }

    const CSS = `
      .bsx-root {
        --bsx-layer-3: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
        --bsx-line-strong: color-mix(in srgb, var(--dsw-alias-label-secondary) 34%, transparent);
        --bsx-faint: color-mix(in srgb, var(--dsw-alias-label-secondary) 78%, transparent);
        --bsx-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
        --bsx-success-soft: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
        --bsx-warn-soft: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent);
        --bsx-warn-text: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 86%, var(--dsw-alias-label-primary));
        --bsx-accent-soft: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent);
        --bsx-on-accent: #ffffff;
        display: flex; flex-direction: column; height: 100%; min-height: 0;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        font-size: 13px; line-height: 1.5;
      }
      .bsx-head { display:flex; align-items:center; gap:14px; padding:9px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); flex:none; }
      .bsx-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; white-space:nowrap; }
      .bsx-tag { padding:1px 7px; border-radius:999px; background: var(--bsx-layer-3); color: var(--bsx-faint); font-size:11px; font-weight:500; }
      .bsx-sub { margin-top:4px; color: var(--bsx-faint); font-size:12px; }
      .bsx-head-actions { display:flex; gap:6px; flex:none; margin-left:auto; }
      .bsx-body { flex:1; min-height:0; overflow:auto; padding:10px 14px 12px; display:flex; flex-direction:column; gap:10px; }
      .bsx-card { border:1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); border-radius:10px; padding:10px 12px; }
      .bsx-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .bsx-card-title { font-size:13px; font-weight:600; }
      .bsx-hint { color: var(--bsx-faint); font-size:12px; }
      .bsx-btn { appearance:none; border:1px solid var(--bsx-line-strong); background:transparent; color: var(--dsw-alias-label-primary); border-radius:8px; padding:5px 12px; font:inherit; font-size:12px; cursor:pointer; white-space:nowrap; }
      .bsx-btn:hover:not(:disabled) { background: var(--bsx-hover); }
      .bsx-btn:disabled { opacity:.45; cursor:not-allowed; }
      .bsx-btn.primary { background: var(--dsw-alias-brand-primary); border-color:transparent; color: var(--bsx-on-accent); font-weight:500; }
      .bsx-btn.primary:hover:not(:disabled) { filter:brightness(1.08); }
      .bsx-btn.small { padding:2px 9px; font-size:11px; }
      .bsx-drop { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; width:100%; box-sizing:border-box; padding:26px 16px; border:1px dashed var(--bsx-line-strong); border-radius:10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font:inherit; cursor:pointer; transition:border-color .15s, background .15s; }
      .bsx-drop:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); background: var(--bsx-accent-soft); }
      .bsx-drop:disabled { opacity:.5; cursor:not-allowed; }
      .bsx-drop-title { font-size:13px; font-weight:600; }
      .bsx-stats { display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; flex:none; }
      .bsx-stat { display:inline-flex; align-items:baseline; gap:6px; }
      .bsx-stat-label { display:inline-flex; align-items:center; gap:5px; color: var(--bsx-faint); font-size:11.5px; }
      .bsx-stat-value { font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; }
      .bsx-dot { width:7px; height:7px; border-radius:50%; background: var(--dsw-alias-state-idle-primary); }
      .bsx-dot.passed { background: var(--dsw-alias-state-success-primary); }
      .bsx-dot.rejected { background: var(--dsw-alias-state-error-primary); }
      .bsx-dot.review { background: var(--dsw-alias-state-warn-primary); }
      .bsx-dot.pending { background: var(--dsw-alias-brand-primary); }
      .bsx-dot.failed { background: var(--dsw-alias-state-error-primary); opacity:.55; }
      .bsx-tabs { display:flex; gap:4px; border-bottom:1px solid var(--dsw-alias-border-l1); }
      .bsx-tab { appearance:none; border:none; background:transparent; color: var(--dsw-alias-label-secondary); font:inherit; font-size:13px; padding:7px 12px; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
      .bsx-tab:hover { color: var(--dsw-alias-label-primary); }
      .bsx-tab.active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight:600; }
      .bsx-textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding:8px 10px; font-size:12px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
      .bsx-textarea::placeholder { color: var(--bsx-faint); }
      .bsx-input { flex:1; min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding:5px 10px; font:inherit; font-size:12px; }
      .bsx-input::placeholder { color: var(--bsx-faint); }
      .bsx-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .bsx-chips { display:flex; gap:6px; flex-wrap:wrap; }
      .bsx-chip { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:transparent; color: var(--dsw-alias-label-secondary); border-radius:999px; padding:3px 10px; font:inherit; font-size:12px; cursor:pointer; text-align:left; }
      .bsx-chip:hover { background: var(--bsx-hover); }
      .bsx-chip.active { background: var(--bsx-accent-soft); color: var(--dsw-alias-label-primary); border-color: var(--bsx-line-strong); font-weight:500; }
      .bsx-table-wrap { flex:1; min-height:0; overflow:auto; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; }
      .bsx-table { width:100%; border-collapse:separate; border-spacing:0; font-size:12.5px; table-layout:fixed; }
      .bsx-table th { position:sticky; top:0; z-index:2; text-align:left; font-weight:500; color: var(--bsx-faint); background: var(--dsw-alias-bg-layer-2); padding:6px 10px; border-bottom:1px solid var(--dsw-alias-border-l2); white-space:nowrap; }
      .bsx-table td { padding:6px 10px; border-bottom:1px solid var(--dsw-alias-border-l1); vertical-align:top; }
      .bsx-table tr:last-child td { border-bottom:none; }
      .bsx-table tbody tr:hover td { background: var(--bsx-hover); }
      .bsx-clamp { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .bsx-clamp.one { -webkit-line-clamp:1; }
      .bsx-runbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; flex:none; }
      .bsx-badge { display:inline-flex; align-items:center; gap:5px; padding:1px 8px; border-radius:999px; font-size:11px; white-space:nowrap; background: var(--bsx-layer-3); color: var(--dsw-alias-label-secondary); }
      .bsx-badge.passed { background: var(--bsx-success-soft); color: var(--dsw-alias-state-success-primary); }
      .bsx-badge.rejected { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 13%, transparent); color: var(--dsw-alias-state-error-primary); }
      .bsx-badge.review { background: var(--bsx-warn-soft); color: var(--bsx-warn-text); }
      .bsx-badge.failed { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 13%, transparent); color: var(--dsw-alias-state-error-primary); border:1px dashed currentColor; }
      .bsx-reason { color: var(--bsx-faint); font-size:11px; margin-top:2px; white-space:pre-wrap; word-break:break-word; }
      .bsx-select { border:1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); border-radius:6px; padding:1px 4px; font:inherit; font-size:11px; }
      .bsx-progress { height:4px; border-radius:999px; background: var(--bsx-layer-3); overflow:hidden; }
      .bsx-progress > div { height:100%; background: var(--dsw-alias-brand-primary); transition: width .3s ease; }
      .bsx-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:34px 16px; border:1px dashed var(--bsx-line-strong); border-radius:12px; text-align:center; }
      .bsx-empty-title { font-size:14px; font-weight:600; }
      .bsx-empty-body { color: var(--bsx-faint); font-size:12px; max-width:520px; }
      .bsx-history { display:flex; flex-direction:column; gap:6px; overflow:auto; flex:1; min-height:0; }
      .bsx-history-item { display:flex; align-items:center; gap:12px; padding:8px 12px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); }
      .bsx-history-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
      .bsx-history-name { font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bsx-history-actions { display:flex; gap:6px; flex:none; }
      .bsx-pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex:none; padding-top:2px; }
      .bsx-pager-info { color: var(--bsx-faint); font-size:11.5px; font-variant-numeric:tabular-nums; }
      .bsx-pager-gap { flex:1; }
      .bsx-page-btn { min-width:26px; text-align:center; padding:2px 8px; }
      .bsx-page-btn.active { background: var(--bsx-accent-soft); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); font-weight:600; }
      .bsx-alert { border:1px solid var(--dsw-alias-border-l2); border-left:3px solid var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border-radius:8px; padding:8px 10px; color: var(--dsw-alias-label-secondary); font-size:12px; white-space:pre-wrap; }
      .bsx-rule { display:grid; grid-template-columns:24px 1fr; gap:10px; padding:8px 0; border-bottom:1px dashed var(--dsw-alias-border-l1); }
      .bsx-rule:last-child { border-bottom:none; }
      .bsx-rule-n { color: var(--bsx-faint); font-size:11px; font-variant-numeric:tabular-nums; }
      .bsx-rule-t { font-weight:500; }
      .bsx-rule-d { color: var(--bsx-faint); font-size:12px; }
      .bsx-count { margin-left:6px; color: var(--bsx-warn-text); font-size:11px; }
      .bsx-kw { display:inline-block; margin:2px 4px 2px 0; padding:1px 6px; border-radius:6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size:11px; }
      .bsx-qa { display:flex; flex-direction:column; gap:10px; }
      .bsx-msg { max-width:88%; padding:8px 11px; border-radius:10px; font-size:12.5px; white-space:pre-wrap; word-break:break-word; }
      .bsx-msg.user { align-self:flex-end; background: var(--bsx-accent-soft); color: var(--dsw-alias-label-primary); }
      .bsx-msg.assistant { align-self:flex-start; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .bsx-msg.assistant.error { color: var(--dsw-alias-state-error-primary); }
      .bsx-sugg { display:flex; gap:6px; flex-wrap:wrap; }
      .bsx-spacer { flex:1; }
      .bsx-monitor { display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background: var(--dsw-alias-bg-layer-1); flex:none; }
      .bsx-monitor-head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
      .bsx-monitor-meta { color: var(--bsx-faint); font-size:11.5px; font-variant-numeric:tabular-nums; }
      .bsx-monitor-empty { color: var(--bsx-faint); font-size:12px; padding:4px 2px; }
      .bsx-token-bar { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding:6px 9px; border-radius:8px; background: var(--dsw-alias-bg-layer-2); }
      .bsx-token-item { display:inline-flex; align-items:baseline; gap:5px; color: var(--bsx-faint); font-size:11.5px; }
      .bsx-token-value { color: var(--dsw-alias-label-primary); font-weight:600; font-variant-numeric:tabular-nums; }
      .bsx-lane { display:grid; grid-template-columns:58px 52px minmax(100px,1fr) 148px 72px 92px; gap:10px; align-items:center; padding:4px 8px; border-radius:8px; font-size:12px; }
      .bsx-lane.running { background: var(--bsx-accent-soft); }
      .bsx-lane-no { color: var(--bsx-faint); font-size:11.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .bsx-lane-titles { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bsx-lane-stage { color: var(--dsw-alias-label-secondary); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .bsx-lane-time { color: var(--bsx-faint); font-size:11.5px; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .bsx-lane.done .bsx-lane-stage { color: var(--dsw-alias-state-success-primary); }
      .bsx-lane.failed .bsx-lane-stage { color: var(--dsw-alias-state-error-primary); }
      .bsx-lane.cancelled .bsx-lane-stage { color: var(--bsx-faint); }
      .bsx-done-list { max-height:220px; overflow:auto; }
    `

    /** Client locale service, captured in apply() before the view mounts. */
    let localeService = null

    /** Resolve one of our host routes against the page base (proxy-prefix safe). */
    function routeUrl(path) {
      let base
      try {
        base = new URL(typeof document === 'undefined' ? 'http://dsh.internal/' : document.baseURI)
      } catch {
        base = new URL('http://dsh.internal/')
      }
      base.search = ''
      base.hash = ''
      if (!base.pathname.endsWith('/')) base.pathname += '/'
      return new URL(String(path).replace(/^\/+/, ''), base).href
    }

    /** POST one operation to the host half and unwrap its `{ok, value}` envelope. */
    async function call(method, payload) {
      let response
      try {
        response = await fetch(routeUrl(`book-select/api/${method}`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
          credentials: 'same-origin',
          cache: 'no-store',
        })
      } catch (error) {
        throw new Error(`无法连接选书服务（${error?.message ?? error}）。请刷新页面后重试。`)
      }
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.error?.message ?? `请求失败（HTTP ${response.status}）`)
      }
      return data.value
    }

    /** Compose the CSV the browser downloads (UTF-8 BOM so Excel opens it). */
    function downloadCsv(rows, filename) {
      const text = rows
        .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n')
      const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2_000)
    }

    /** Read a picked file into `{text}` (delimiter tables) or `{base64}` (xlsx). */
    function readPickedFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('读取文件失败。'))
        if (/\.(xlsx|xls)$/i.test(file.name)) {
          reader.onload = () => {
            const result = String(reader.result ?? '')
            const comma = result.indexOf(',')
            resolve({ base64: comma >= 0 ? result.slice(comma + 1) : '', filename: file.name })
          }
          reader.readAsDataURL(file)
        } else {
          reader.onload = () => resolve({ text: String(reader.result ?? ''), filename: file.name })
          reader.readAsText(file, 'utf-8')
        }
      })
    }

    /** Status → dictionary key. */
    const STATUS_LABEL = {
      pending: 'statusPending',
      passed: 'statusPassed',
      rejected: 'statusRejected',
      review: 'statusReview',
      failed: 'statusFailed',
    }

    /** Verdict origin → dictionary key. */
    const SOURCE_LABEL = { rule: 'sourceRule', ai: 'sourceAi', manual: 'sourceManual' }

    /** Batch sizes offered in the run bar. */
    const BATCH_CHOICES = [5, 10, 15, 20, 30, 40]

    /** How many batches may be screened at the same time. */
    const CONCURRENCY_CHOICES = [1, 2, 3, 4, 6]

    /** Rows rendered at once; filters and export still see every record. */
    const PAGE_SIZES = [20, 50, 100, 200]

    /** Host-side state key: one shared acquisition list for the whole app. */
    const WORKSPACE_ID = 'workbench'

    /**
     * The sidebar panel icon: the sidebar owns the button, so this only draws.
     * @param {{size: number, active: boolean}} props - icon presentation.
     * @returns {object} the icon element.
     */
    function BookSelectIcon(props) {
      const size = props?.size ?? 18
      const color = props?.active === true ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z' }),
        h('path', { d: 'M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z' }),
        h('path', { d: 'm9 10.5 2 2 4-4' }),
      )
    }

    /**
     * The workbench page, rendered as the `main` panel behind the sidebar icon.
     * @returns {object} the page element.
     */
    function BookSelectView() {
      const sessionId = WORKSPACE_ID
      const locale = localeService
      const t = React.useMemo(() => locale.bind(NS), [locale])

      const [summary, setSummary] = React.useState(null)
      const [items, setItems] = React.useState([])
      const [rules, setRules] = React.useState(null)
      const [tab, setTab] = React.useState('data')
      const [filter, setFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      const [exportScope, setExportScope] = React.useState('all')
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [messages, setMessages] = React.useState([])
      const [question, setQuestion] = React.useState('')
      const [batchSize, setBatchSize] = React.useState(15)
      const [concurrency, setConcurrency] = React.useState(3)
      const [expanded, setExpanded] = React.useState({})
      const [page, setPage] = React.useState(1)
      const [pageSize, setPageSize] = React.useState(50)
      const [historyOpen, setHistoryOpen] = React.useState(false)
      const [historyEntries, setHistoryEntries] = React.useState([])
      const [historyBusy, setHistoryBusy] = React.useState('')
      // The batch monitor: folded away by default, opened once per run.
      const [monitorOpen, setMonitorOpen] = React.useState(false)
      const [monitorTouched, setMonitorTouched] = React.useState(false)
      const [showAllBatches, setShowAllBatches] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())
      const [, setLocaleRevision] = React.useState(0)
      const fileRef = React.useRef(null)
      const seenJobId = React.useRef(null)

      /** Toggle the summary row of one book. */
      const toggleDetail = (id) => setExpanded((previous) => ({ ...previous, [id]: previous[id] !== true }))

      // Re-render on locale switches and on late-arriving dictionary registrations.
      React.useEffect(() => {
        if (locale === null || typeof locale.subscribe !== 'function') return undefined
        const off = locale.subscribe(() => setLocaleRevision((value) => value + 1))
        return typeof off === 'function' ? off : undefined
      }, [locale])

      /** Merge a host snapshot into local state (items only when present). */
      const applySnapshot = React.useCallback((value) => {
        if (value === null || value === undefined) return
        setSummary(value)
        if (Array.isArray(value.items)) setItems(value.items)
      }, [])

      React.useEffect(() => {
        let active = true
        void (async () => {
          try {
            const [state, digest] = await Promise.all([
              call('state', { sessionId }),
              call('rules', {}),
            ])
            if (!active) return
            applySnapshot(state)
            setRules(digest)
          } catch (failure) {
            if (active) setError(failure?.message ?? String(failure))
          }
        })()
        return () => {
          active = false
        }
      }, [sessionId, applySnapshot])

      // Keep the batch selector in step with the size the host remembered.
      const hostBatchSize = summary?.options?.batchSize
      React.useEffect(() => {
        if (typeof hostBatchSize === 'number' && hostBatchSize > 0) setBatchSize(hostBatchSize)
      }, [hostBatchSize])

      // Same for the concurrency the last run used.
      const hostConcurrency = summary?.options?.concurrency
      React.useEffect(() => {
        if (typeof hostConcurrency === 'number' && hostConcurrency > 0) setConcurrency(hostConcurrency)
      }, [hostConcurrency])

      // While a job runs, poll so each finished batch reaches the table; the
      // verdicts land batch by batch, so the rows have to be re-read as well.
      const jobId = summary?.job?.id
      const jobRunning = summary?.job?.running === true
      const totalBooks = summary?.counts?.total ?? 0
      React.useEffect(() => {
        if (!jobRunning) return undefined
        let stopped = false
        let tick = 0
        const timer = setInterval(async () => {
          tick += 1
          // Big lists: rows every third tick, the counter every tick.
          const withItems = totalBooks <= 1_000 || tick % 3 === 0
          try {
            const value = await call('state', { sessionId, withItems })
            if (stopped) return
            if (Array.isArray(value?.items)) {
              applySnapshot(value)
            } else {
              setSummary(value)
            }
            if (value?.job?.running !== true) {
              const full = await call('state', { sessionId })
              if (!stopped) applySnapshot(full)
            }
          } catch (failure) {
            if (!stopped) setError(failure?.message ?? String(failure))
          }
        }, 1_200)
        return () => {
          stopped = true
          clearInterval(timer)
        }
      }, [jobId, jobRunning, totalBooks, sessionId, applySnapshot])

      // A fresh run opens the batch monitor once. After the librarian folds it
      // away it stays folded — the panel is a glance, not a permanent fixture.
      React.useEffect(() => {
        if (jobId === undefined || jobId === null) return
        if (seenJobId.current === jobId) return
        seenJobId.current = jobId
        setShowAllBatches(false)
        if (!monitorTouched) setMonitorOpen(true)
      }, [jobId, monitorTouched])

      // Elapsed times tick locally, so the running lanes keep moving between
      // the host's polls.
      React.useEffect(() => {
        if (!jobRunning) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1_000)
        return () => clearInterval(timer)
      }, [jobRunning])

      // Cheap revision watcher: a run may also be started from the agent tool,
      // in which case the panel only learns about it here.
      const revision = summary?.revision
      const itemCount = items.length
      React.useEffect(() => {
        if (jobRunning || itemCount === 0) return undefined
        let stopped = false
        const timer = setInterval(async () => {
          try {
            const value = await call('state', { sessionId, withItems: false })
            if (stopped || value === null || value === undefined) return
            if (value.revision === revision && value.job?.running !== true) return
            setSummary(value)
            const full = await call('state', { sessionId })
            if (!stopped) applySnapshot(full)
          } catch {
            // A background refresh stays quiet; the next tick retries.
          }
        }, 3_000)
        return () => {
          stopped = true
          clearInterval(timer)
        }
      }, [jobRunning, itemCount, revision, sessionId, applySnapshot])

      const counts = summary?.counts ?? { total: 0, pending: 0, passed: 0, rejected: 0, review: 0, failed: 0 }
      const hits = summary?.hits

      const visible = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return items.filter((item) => {
          if (filter !== 'all' && item.status !== filter) return false
          if (needle === '') return true
          return [item.title, item.author, item.publisher, item.cls, item.reason]
            .some((value) => String(value ?? '').toLowerCase().includes(needle))
        })
      }, [items, filter, query])

      // Paging: the table shows one page at a time, the export keeps every row.
      const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
      const currentPage = Math.min(page, pageCount)
      const pageItems = React.useMemo(
        () => visible.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        [visible, currentPage, pageSize],
      )

      // A new filter, search or dataset starts at the first page again.
      React.useEffect(() => {
        setPage(1)
      }, [filter, query, totalBooks, pageSize])

      const guard = async (kind, task) => {
        setBusy(kind)
        setError('')
        try {
          await task()
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        } finally {
          setBusy('')
        }
      }

      const doSample = () => guard('sample', async () => {
        const value = await call('sample', { sessionId })
        applySnapshot(value)
        setFilter('all')
        setPage(1)
      })

      const onFileChange = (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file === undefined) return
        void guard('file', async () => {
          const payload = await readPickedFile(file)
          const value = await call('import', { sessionId, ...payload })
          applySnapshot(value)
          setFilter('all')
          setPage(1)
        })
      }

      const doRun = () => guard('run', async () => {
        const value = await call('run', { sessionId, batchSize, concurrency })
        setSummary(value)
      })

      const doCancel = () => guard('cancel', async () => {
        setSummary(await call('cancel', { sessionId }))
        const full = await call('state', { sessionId })
        applySnapshot(full)
      })

      const doReset = () => guard('reset', async () => {
        setSummary(await call('reset', { sessionId }))
        setItems([])
        setMessages([])
        setError('')
        setFilter('all')
        setQuery('')
        setPage(1)
      })

      const override = (id, status) => guard(`status:${id}`, async () => {
        const value = await call('setStatus', { sessionId, id, status })
        setSummary(value)
        setItems((previous) => previous.map((item) => (item.id === id ? { ...item, status, source: 'manual' } : item)))
      })

      /** Re-read the saved-list index; every import and judged batch adds one. */
      const refreshHistory = React.useCallback(async () => {
        const value = await call('history', {})
        setHistoryEntries(Array.isArray(value?.entries) ? value.entries : [])
      }, [])

      /** Show or hide the saved-list panel in place of the book table. */
      const toggleHistory = () => {
        const next = historyOpen !== true
        setHistoryOpen(next)
        if (!next) return
        setHistoryBusy('list')
        void refreshHistory()
          .catch((failure) => setError(failure?.message ?? String(failure)))
          .finally(() => setHistoryBusy(''))
      }

      /** Restore one saved list, verdicts included, into the workbench. */
      const openHistoryEntry = (id) => guard(`history-open:${id}`, async () => {
        const value = await call('loadHistory', { sessionId, id })
        applySnapshot(value)
        setTab('data')
        setFilter('all')
        setQuery('')
        setPage(1)
        setHistoryOpen(false)
        setError('')
      })

      /** Delete one saved list from disk. */
      const removeHistoryEntry = (id) => guard(`history-delete:${id}`, async () => {
        const value = await call('deleteHistory', { sessionId, id })
        setHistoryEntries(Array.isArray(value?.entries) ? value.entries : [])
      })

      /** Short local timestamp for the saved-list rows. */
      const formatTime = (iso) => {
        if (typeof iso !== 'string' || iso === '') return '—'
        const date = new Date(iso)
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
      }

      /**
       * Export the rows in the shape they were imported: every source column,
       * in its original order and with its original header, followed by the
       * four columns the workbench adds. Records without preserved cells (for
       * example a manually edited state) fall back to the canonical fields.
       */
      const doExport = () => {
        const sourceColumns = Array.isArray(summary?.columns) ? summary.columns : []
        const fallbackColumns = [
          t('colNo'), t('colTitle'), t('colPublisher'), t('colCls'), 'ISBN',
          t('colAuthor'), t('colYear'), t('colPrice'), t('colPages'), t('detailSummary'),
        ]
        const baseColumns = sourceColumns.length > 0 ? sourceColumns : fallbackColumns
        const header = [...baseColumns, t('colStatus'), t('colReason'), t('colSource'), t('detailHint')]
        const fallbackCells = (item) => [
          item.no, item.title, item.publisher, item.cls, item.isbn,
          item.author, item.year === 0 ? '' : item.year,
          item.price === 0 ? '' : item.price,
          item.pages, item.summary,
        ]
        const sourceCells = (item) => (
          Array.isArray(item.cells) && item.cells.length >= baseColumns.length
            ? baseColumns.map((_, column) => item.cells[column] ?? '')
            : fallbackCells(item)
        )
        const rows = (exportScope === 'passed' ? visible.filter((item) => item.status === 'passed') : visible)
          .map((item) => [
            ...sourceCells(item),
            t(STATUS_LABEL[item.status] ?? 'statusPending'),
            item.reason,
            item.source === '' ? '' : t(SOURCE_LABEL[item.source] ?? 'sourceAi'),
            item.hint,
          ])
        const scope = exportScope === 'passed' ? 'passed' : 'all'
        downloadCsv([header, ...rows], `book-selection-${scope}-${new Date().toISOString().slice(0, 10)}.csv`)
      }

      const ask = (prompt) => {
        const asked = String(prompt ?? question).trim()
        if (asked === '') {
          setError(t('askEmpty'))
          return
        }
        const history = messages
          .filter((message) => message.pending !== true)
          .map((message) => ({ role: message.role, text: message.text }))
        setMessages((list) => [...list, { role: 'user', text: asked }, { role: 'assistant', text: '', pending: true }])
        setQuestion('')
        setError('')
        setBusy('ask')
        void (async () => {
          try {
            const value = await call('ask', { sessionId, question: asked, history })
            setMessages((list) => list.map((message) => (
              message.pending === true ? { role: 'assistant', text: value.answer } : message
            )))
          } catch (failure) {
            setMessages((list) => list.map((message) => (
              message.pending === true
                ? { role: 'assistant', text: `${t('errPrefix')}${failure?.message ?? failure}`, error: true }
                : message
            )))
          } finally {
            setBusy('')
          }
        })()
      }

      const job = summary?.job
      const percent = job !== null && job !== undefined && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0

      // Batch report: what every batch is doing, how long it took, what it
      // cost. The host sends the whole log with every poll, so this is a pure
      // projection of `job.batchLog`.
      const batchLog = Array.isArray(job?.batchLog) ? job.batchLog : []
      const runningBatches = batchLog.filter((entry) => entry.status === 'running')
      const finishedBatches = batchLog
        .filter((entry) => entry.status !== 'running')
        .slice()
        .sort((a, b) => String(b.endedAt ?? '').localeCompare(String(a.endedAt ?? '')))
      const shownFinished = showAllBatches ? finishedBatches : finishedBatches.slice(0, 10)

      /** Milliseconds as a short seconds string. */
      const formatSeconds = (ms) => {
        const value = Number(ms)
        if (!Number.isFinite(value) || value < 0) return '—'
        return (value / 1000).toFixed(value < 10_000 ? 1 : 0)
      }

      /** Token counts, abbreviated once they reach a thousand. */
      const formatTokens = (value) => {
        const number = Number(value ?? 0)
        if (!Number.isFinite(number) || number <= 0) return '0'
        if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`
        return String(Math.round(number))
      }

      /** The stage line of one batch. */
      const stageLabel = (entry) => {
        const stage = entry?.stage
        if (stage === 'cooling') {
          const seconds = Math.max(1, Math.round(Number(entry?.stageInfo?.delayMs ?? 0) / 1000))
          return t('stageCooling', { seconds })
        }
        if (stage === 'splitting') return t('stageSplitting')
        if (stage === 'parsing') return t('stageParsing')
        if (stage === 'applying') return t('stageApplying')
        return t('stageCalling')
      }

      /** One row of the batch monitor. */
      const batchLane = (entry) => {
        const started = new Date(entry.startedAt ?? 0).getTime()
        const elapsed = entry.status === 'running'
          ? Math.max(0, now - (Number.isFinite(started) ? started : now))
          : Number(entry.elapsedMs ?? 0)
        const stage = entry.status === 'done'
          ? t('batchDone')
          : entry.status === 'failed'
            ? t('batchFailed')
            : entry.status === 'cancelled'
              ? t('batchCancelled')
              : stageLabel(entry)
        const titles = Array.isArray(entry.titles) ? entry.titles.join('、') : ''
        const tokens = entry.usage === null || entry.usage === undefined
          ? ''
          : `${formatTokens(entry.usage.inputTokens)} / ${formatTokens(entry.usage.outputTokens)}`
        return h('div', { className: `bsx-lane ${entry.status}`, key: `lane-${entry.no}` },
          h('div', { className: 'bsx-lane-no' }, `${t('batchNoLabel')} ${entry.no}`),
          h('div', { className: 'bsx-lane-no' }, `${entry.bookCount} ${t('booksUnit')}`),
          h('div', { className: 'bsx-lane-titles', title: titles }, titles),
          h('div', { className: 'bsx-lane-stage', title: stage }, stage),
          h('div', { className: 'bsx-lane-time' }, `${formatSeconds(elapsed)}s`),
          h('div', { className: 'bsx-lane-time' }, tokens),
        )
      }

      const elapsedValues = finishedBatches.map((entry) => Number(entry.elapsedMs ?? 0)).filter((value) => value > 0)
      const avgMs = elapsedValues.length === 0
        ? 0
        : elapsedValues.reduce((sum, value) => sum + value, 0) / elapsedValues.length
      const slowest = elapsedValues.length === 0
        ? null
        : finishedBatches.reduce((slow, entry) => (
          Number(entry.elapsedMs ?? 0) > Number(slow.elapsedMs ?? 0) ? entry : slow
        ), finishedBatches[0])
      const jobStart = new Date(job?.startedAt ?? 0).getTime()
      const jobEnd = job?.finishedAt === null || job?.finishedAt === undefined
        ? now
        : new Date(job.finishedAt).getTime()
      const runElapsed = Number.isFinite(jobStart) && Number.isFinite(jobEnd) ? Math.max(0, jobEnd - jobStart) : 0

      const usage = job?.usage ?? null
      const tokenInput = Number(usage?.inputTokens ?? 0)
      const tokenOutput = Number(usage?.outputTokens ?? 0)
      const tokenTotal = Number(usage?.totalTokens ?? 0) || tokenInput + tokenOutput
      const booksJudged = Number(job?.total ?? 0)
      const perBook = booksJudged > 0 ? tokenTotal / booksJudged : 0
      // The rule prompt is sent again with every batch, so the smallest input
      // count of the run is roughly that fixed cost.
      const inputSamples = batchLog.map((entry) => Number(entry?.usage?.inputTokens ?? 0)).filter((value) => value > 0)
      const fixedPrompt = inputSamples.length >= 2 ? Math.min(...inputSamples) : null

      const monitorButton = h('button', {
        className: `bsx-btn small${monitorOpen ? ' primary' : ''}`,
        type: 'button',
        onClick: () => {
          setMonitorTouched(true)
          setMonitorOpen((open) => !open)
        },
      }, t('batchMonitor'))

      const monitorBody = h('div', { className: 'bsx-monitor', key: 'monitor' },
        h('div', { className: 'bsx-monitor-head' },
          h('div', { className: 'bsx-monitor-meta' }, `${t('elapsedLabel')} ${formatSeconds(runElapsed)}s`),
          avgMs > 0 ? h('div', { className: 'bsx-monitor-meta' }, t('avgPerBatch', { seconds: formatSeconds(avgMs) })) : null,
          slowest !== null ? h('div', { className: 'bsx-monitor-meta' }, t('slowestBatch', { no: slowest.no, seconds: formatSeconds(slowest.elapsedMs) })) : null,
          h('div', { className: 'bsx-monitor-meta' }, t('finishedBatches', { count: finishedBatches.length })),
        ),
        tokenTotal > 0
          ? h('div', { className: 'bsx-token-bar' },
            h('div', { className: 'bsx-token-item' }, `${t('tokenTitle')} `, h('span', { className: 'bsx-token-value' }, formatTokens(tokenTotal))),
            h('div', { className: 'bsx-token-item' }, `${t('tokenIn')} `, h('span', { className: 'bsx-token-value' }, formatTokens(tokenInput))),
            h('div', { className: 'bsx-token-item' }, `${t('tokenOut')} `, h('span', { className: 'bsx-token-value' }, formatTokens(tokenOutput))),
            perBook > 0 ? h('div', { className: 'bsx-token-item' }, t('tokenPerBook', { value: formatTokens(perBook) })) : null,
            fixedPrompt !== null ? h('div', { className: 'bsx-token-item' }, t('tokenFixedPrompt', { value: formatTokens(fixedPrompt) })) : null,
          )
          : null,
        runningBatches.length > 0 ? h('div', {}, runningBatches.map(batchLane)) : null,
        batchLog.length === 0 ? h('div', { className: 'bsx-monitor-empty' }, t('noBatchRecords')) : null,
        finishedBatches.length > 0
          ? h('div', { className: 'bsx-done-list' },
            shownFinished.map(batchLane),
            finishedBatches.length > 10
              ? h('button', {
                className: 'bsx-btn small',
                type: 'button',
                style: { marginTop: '6px' },
                onClick: () => setShowAllBatches((value) => !value),
              }, showAllBatches ? t('showFewerBatches', { count: 10 }) : t('showAllBatches', { count: finishedBatches.length }))
              : null,
          )
          : null,
      )

      const statCard = (key, value, tone) => h('div', { className: 'bsx-stat', key },
        h('div', { className: 'bsx-stat-label' }, h('span', { className: `bsx-dot ${tone}` }), t(key)),
        h('div', { className: 'bsx-stat-value' }, String(value)),
      )

      // The empty list still shows the real workspace: counters, controls and
      // the table frame, with the file picker sitting where rows would be.
      const pickPrompt = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' } },
        h('button', {
          className: 'bsx-drop',
          type: 'button',
          disabled: busy !== '',
          style: { maxWidth: 460 },
          onClick: () => fileRef.current?.click(),
        },
          h('div', { className: 'bsx-drop-title' }, busy === 'file' ? t('importing') : t('pickFile')),
          h('div', { className: 'bsx-hint' }, t('pickFileHint')),
        ),
      )

      // A run screens whatever is still pending, then retries failed batches;
      // with no pending left the button becomes an explicit failure retry.
      const runnable = (counts.pending ?? 0) + (counts.failed ?? 0) > 0
      const retryOnly = (counts.pending ?? 0) === 0 && (counts.failed ?? 0) > 0
      const runBar = h('div', { className: 'bsx-runbar', key: 'run' },
        h('button', { className: 'bsx-btn primary', type: 'button', disabled: busy !== '' || jobRunning || !runnable, onClick: doRun },
          jobRunning ? t('running') : retryOnly ? t('retryFailed') : t('run')),
        jobRunning ? h('button', { className: 'bsx-btn', type: 'button', disabled: busy !== '', onClick: doCancel }, t('cancel')) : null,
        h('label', { className: 'bsx-hint', style: { display: 'flex', alignItems: 'center', gap: 6 } },
          t('batch'),
          h('select', {
            className: 'bsx-select',
            value: batchSize,
            disabled: jobRunning,
            onChange: (event) => setBatchSize(Number(event.target.value)),
          }, BATCH_CHOICES.map((size) => h('option', { key: size, value: size }, String(size)))),
          t('booksUnit'),
        ),
        h('label', { className: 'bsx-hint', style: { display: 'flex', alignItems: 'center', gap: 6 } },
          t('concurrency'),
          h('select', {
            className: 'bsx-select',
            value: concurrency,
            disabled: jobRunning,
            onChange: (event) => setConcurrency(Number(event.target.value)),
          }, CONCURRENCY_CHOICES.map((count) => h('option', { key: count, value: count }, String(count)))),
          t('concurrencyUnit'),
        ),
        job === null || job === undefined
          ? null
          : h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 } },
            h('div', { className: 'bsx-progress', style: { flex: 1 } }, h('div', { style: { width: `${percent}%` } })),
            h('span', { className: 'bsx-hint', style: { whiteSpace: 'nowrap' } },
              `${job.phase === 'retry' ? `${t('phaseRetry')} · ` : ''}${job.done}/${job.total} · ${job.batchesDone}/${job.batches} ${t('batches')}${typeof job.concurrency === 'number' ? ` · ${t('concurrency')} ${job.concurrency}` : ''}${job.failed > 0 ? ` · ${t('failed')} ${job.failed}` : ''}`),
          ),
        batchLog.length > 0
          ? h('span', { className: 'bsx-badge' }, runningBatches.length > 0
            ? t('runningBatches', { count: runningBatches.length })
            : t('finishedBatches', { count: finishedBatches.length }))
          : null,
        monitorButton,
        h('span', { className: 'bsx-hint', style: { marginLeft: 'auto', whiteSpace: 'nowrap' } }, `${t('model')}: ${summary?.model ?? '—'}`),
      )

      const filterChips = [
        ['all', t('filterAll'), counts.total],
        ['pending', t('statusPending'), counts.pending],
        ['passed', t('statusPassed'), counts.passed],
        ['rejected', t('statusRejected'), counts.rejected],
        ['review', t('statusReview'), counts.review],
        ['failed', t('statusFailed'), counts.failed ?? 0],
      ].map(([value, label, count]) => h('button', {
        key: value,
        type: 'button',
        className: `bsx-chip${filter === value ? ' active' : ''}`,
        onClick: () => setFilter(value),
      }, `${label} ${count}`))

      const toolbar = h('div', { className: 'bsx-row', key: 'toolbar' },
        h('div', { className: 'bsx-chips' }, filterChips),
        h('div', { className: 'bsx-row', style: { flex: 1, justifyContent: 'flex-end', minWidth: 320 } },
          h('input', { className: 'bsx-input', value: query, placeholder: t('search'), onChange: (event) => setQuery(event.target.value) }),
          h('label', { className: 'bsx-hint', style: { display: 'flex', alignItems: 'center', gap: 6 } },
            t('exportScope'),
            h('select', {
              className: 'bsx-select',
              value: exportScope,
              onChange: (event) => setExportScope(event.target.value),
            },
              h('option', { value: 'all' }, t('scopeAll')),
              h('option', { value: 'passed' }, t('scopePassed')),
            ),
          ),
          h('button', { className: 'bsx-btn', type: 'button', disabled: visible.length === 0, onClick: doExport }, t('export')),
        ),
      )

      const rows = []
      for (const item of pageItems) {
        const open = expanded[item.id] === true
        rows.push(h('tr', { key: item.id },
          h('td', { style: { color: 'var(--bsx-faint)', fontVariantNumeric: 'tabular-nums' } }, item.no),
          h('td', {},
            h('div', {
              className: open ? '' : 'bsx-clamp',
              style: { fontWeight: 500, cursor: 'pointer' },
              title: open ? t('detailClose') : t('detailOpen'),
              onClick: () => toggleDetail(item.id),
            }, `${open ? '▾' : '▸'} ${item.title}`),
            item.author === '' ? null : h('div', { className: 'bsx-reason' }, item.author),
            item.hint === '' ? null : h('div', { className: 'bsx-reason' }, `${t('detailHint')} · ${item.hint}`),
          ),
          h('td', { title: item.publisher }, h('div', { className: 'bsx-clamp one' }, item.publisher)),
          h('td', { style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 } }, item.cls),
          h('td', {}, item.year === 0 ? '—' : String(item.year)),
          h('td', { style: { fontVariantNumeric: 'tabular-nums' } }, item.price === 0 ? '—' : String(item.price)),
          h('td', {}, item.pages === '' ? '—' : item.pages),
          h('td', {},
            h('span', { className: `bsx-badge ${item.status}` }, t(STATUS_LABEL[item.status] ?? 'statusPending')),
            item.source === '' ? null : h('div', { className: 'bsx-reason' }, t(SOURCE_LABEL[item.source] ?? 'sourceAi')),
          ),
          h('td', {},
            h('div', { className: 'bsx-reason' }, item.reason === '' ? '—' : item.reason),
            h('select', {
              className: 'bsx-select',
              value: item.status,
              onChange: (event) => override(item.id, event.target.value),
            }, ['passed', 'rejected', 'review', 'pending', 'failed'].map((status) => h('option', { key: status, value: status }, t(STATUS_LABEL[status])))),
          ),
        ))
        if (open) {
          rows.push(h('tr', { key: `${item.id}-detail` },
            h('td', { colSpan: 9, style: { background: 'var(--dsw-alias-bg-layer-1)', padding: '10px 12px' } },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 } }, item.summary === '' ? '—' : item.summary),
                h('div', { className: 'bsx-hint' }, `${t('detailIsbn')} ${item.isbn === '' ? '—' : item.isbn} · ${t('detailEdition')} ${item.edition === '' ? '—' : item.edition}`),
                item.hint === '' ? null : h('div', { className: 'bsx-hint' }, `${t('detailHint')}：${item.hint}`),
              ),
            ),
          ))
        }
      }

      const emptyRow = items.length === 0
        ? h('tr', {}, h('td', { colSpan: 9, style: { padding: 0 } }, pickPrompt))
        : h('tr', {}, h('td', { colSpan: 9, style: { padding: '40px 16px', textAlign: 'center' } },
          h('div', { className: 'bsx-empty-title' }, t('emptyTitle')),
          h('div', { className: 'bsx-empty-body', style: { marginTop: 4 } }, t('emptyFiltered')),
        ))

      // Pager: numbered buttons with a short window around the current page.
      const pageButtons = []
      const windowSize = 2
      const firstPage = Math.max(1, currentPage - windowSize)
      const lastPage = Math.min(pageCount, currentPage + windowSize)
      for (let index = firstPage; index <= lastPage; index += 1) {
        pageButtons.push(h('button', {
          key: `page-${index}`,
          type: 'button',
          className: `bsx-btn small bsx-page-btn${index === currentPage ? ' active' : ''}`,
          onClick: () => setPage(index),
        }, String(index)))
      }
      const pager = h('div', { className: 'bsx-pager', key: 'pager' },
        h('span', { className: 'bsx-pager-info' }, t('pageTotal', { count: visible.length })),
        h('span', { className: 'bsx-pager-info' }, t('pageInfo', { page: currentPage, total: pageCount })),
        h('div', { className: 'bsx-row', style: { gap: 4 } },
          h('button', {
            type: 'button',
            className: 'bsx-btn small bsx-page-btn',
            disabled: currentPage <= 1,
            onClick: () => setPage(1),
          }, t('pageFirst')),
          h('button', {
            type: 'button',
            className: 'bsx-btn small bsx-page-btn',
            disabled: currentPage <= 1,
            onClick: () => setPage(currentPage - 1),
          }, t('pagePrev')),
          ...pageButtons,
          h('button', {
            type: 'button',
            className: 'bsx-btn small bsx-page-btn',
            disabled: currentPage >= pageCount,
            onClick: () => setPage(currentPage + 1),
          }, t('pageNext')),
          h('button', {
            type: 'button',
            className: 'bsx-btn small bsx-page-btn',
            disabled: currentPage >= pageCount,
            onClick: () => setPage(pageCount),
          }, t('pageLast')),
        ),
        h('span', { className: 'bsx-pager-gap' }),
        h('label', { className: 'bsx-hint', style: { display: 'flex', alignItems: 'center', gap: 6 } },
          t('pageSize'),
          h('select', {
            className: 'bsx-select',
            value: pageSize,
            onChange: (event) => setPageSize(Number(event.target.value)),
          }, PAGE_SIZES.map((size) => h('option', { key: size, value: size }, `${size} ${t('pageUnit')}`))),
        ),
      )

      const table = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0 } },
        h('div', { className: 'bsx-table-wrap' },
          h('table', { className: 'bsx-table' },
            h('colgroup', {},
              h('col', { style: { width: 46 } }),
              h('col', { style: { width: 200 } }),
              h('col', { style: { width: 112 } }),
              h('col', { style: { width: 78 } }),
              h('col', { style: { width: 52 } }),
              h('col', { style: { width: 58 } }),
              h('col', { style: { width: 62 } }),
              h('col', { style: { width: 68 } }),
              h('col', {}),
            ),
            h('thead', {}, h('tr', {},
              h('th', {}, t('colNo')),
              h('th', {}, t('colTitle')),
              h('th', {}, t('colPublisher')),
              h('th', {}, t('colCls')),
              h('th', {}, t('colYear')),
              h('th', {}, t('colPrice')),
              h('th', {}, t('colPages')),
              h('th', {}, t('colStatus')),
              h('th', {}, t('colReason')),
            )),
            h('tbody', {}, visible.length === 0 ? emptyRow : rows),
          ),
        ),
        visible.length > 0 ? pager : null,
        h('div', { className: 'bsx-hint', style: { padding: '2px 2px 0', flex: 'none' } },
          items.length === 0
            ? t('importHint')
            : summary?.note === undefined || summary.note === ''
              ? t('pageNote')
              : `${summary.note} · ${counts.total} ${t('booksUnit')} · ${t('pageNote')}`),
      )

      // The workspace keeps its full shape before the first import: counters at
      // zero, controls disabled, and the picker inside the empty table.
      const dataPanel = h('div', { key: 'data', style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 } },
        runBar,
        monitorOpen ? monitorBody : null,
        toolbar,
        table,
      )

      const historyPanel = h('div', { key: 'history', style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'bsx-row' },
          h('div', { className: 'bsx-card-title' }, t('historyTitle')),
          h('div', { className: 'bsx-hint', style: { flex: 1, marginLeft: 8 } }, t('historyHint')),
          h('button', { className: 'bsx-btn small', type: 'button', onClick: toggleHistory }, t('historyClose')),
        ),
        historyEntries.length === 0
          ? h('div', { className: 'bsx-empty' },
            h('div', { className: 'bsx-empty-title' }, historyBusy === 'list' ? t('loading') : t('historyEmpty')),
            h('div', { className: 'bsx-empty-body' }, t('historyEmptyBody')),
          )
          : h('div', { className: 'bsx-history' }, historyEntries.map((entry) => h('div', { className: 'bsx-history-item', key: entry.id },
            h('div', { className: 'bsx-history-main' },
              h('div', { className: 'bsx-history-name', title: entry.filename }, entry.filename === '' || entry.filename === undefined ? t('historyUntitled') : entry.filename),
              h('div', { className: 'bsx-hint' },
                `${formatTime(entry.updatedAt ?? entry.importedAt)} · ${entry.total} ${t('booksUnit')} · `
                + `${t('statusPassed')} ${entry.counts?.passed ?? 0} / ${t('statusRejected')} ${entry.counts?.rejected ?? 0} / `
                + `${t('statusReview')} ${entry.counts?.review ?? 0} / ${t('statusPending')} ${entry.counts?.pending ?? 0}`
                + ((entry.counts?.failed ?? 0) > 0 ? ` / ${t('statusFailed')} ${entry.counts.failed}` : '')),
            ),
            h('div', { className: 'bsx-history-actions' },
              h('button', { className: 'bsx-btn small primary', type: 'button', disabled: busy !== '', onClick: () => openHistoryEntry(entry.id) }, t('historyLoad')),
              h('button', { className: 'bsx-btn small', type: 'button', disabled: busy !== '', onClick: () => removeHistoryEntry(entry.id) }, t('historyDelete')),
            ),
          ))),
      )

      const rulesPanel = rules === null
        ? h('div', { className: 'bsx-hint' }, '…')
        : h('div', { key: 'rules', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          h('section', { className: 'bsx-card' },
            h('div', { className: 'bsx-card-title' }, t('rulesPrefilter')),
            h('div', { className: 'bsx-hint', style: { margin: '4px 0 10px' } }, t('rulesPrefilterHint')),
            ...rules.prefilter.map((rule, index) => h('div', { className: 'bsx-rule', key: rule.id },
              h('div', { className: 'bsx-rule-n' }, String(index + 1)),
              h('div', {},
                h('div', { className: 'bsx-rule-t' }, rule.title,
                  hits === null || hits === undefined ? null : h('span', { className: 'bsx-count' }, `${t('rulesHits')} ${hits[rule.id] ?? 0}`),
                ),
                h('div', { className: 'bsx-rule-d' }, rule.detail),
                h('div', { className: 'bsx-rule-d' }, rule.reason),
              ),
            )),
          ),
          h('section', { className: 'bsx-card' },
            h('div', { className: 'bsx-card-title' }, t('rulesClass')),
            ...rules.classes.map((rule) => h('div', { className: 'bsx-rule', key: rule.code },
              h('div', { className: 'bsx-rule-n' }, rule.code),
              h('div', { className: 'bsx-rule-d', style: { color: 'var(--dsw-alias-label-secondary)' } }, rule.text),
            )),
          ),
          h('section', { className: 'bsx-card' },
            h('div', { className: 'bsx-card-title' }, t('rulesContent')),
            ...rules.content.map((rule) => h('div', { className: 'bsx-rule', key: rule.n },
              h('div', { className: 'bsx-rule-n' }, String(rule.n)),
              h('div', { className: 'bsx-rule-d', style: { color: 'var(--dsw-alias-label-secondary)' } }, rule.text),
            )),
          ),
          h('section', { className: 'bsx-card' },
            h('div', { className: 'bsx-card-title' }, `${t('rulesWhitelist')} · ${rules.whitelist.length}`),
            h('div', { style: { marginTop: 8 } }, rules.whitelist.map((name) => h('span', { className: 'bsx-kw', key: name }, name))),
            h('div', { className: 'bsx-card-title', style: { marginTop: 14 } }, `${t('rulesKeywords')} · ${rules.keywords.length}`),
            h('div', { className: 'bsx-hint', style: { marginTop: 4 } }, t('keywordNote')),
            h('div', { style: { marginTop: 8 } }, rules.keywords.map((name) => h('span', { className: 'bsx-kw', key: name }, name))),
          ),
          h('section', { className: 'bsx-card' },
            h('div', { className: 'bsx-card-title' }, t('rulesOutput')),
            h('div', { className: 'bsx-hint', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, t('rulesOutputBody')),
          ),
        )

      const suggestions = [t('qaSugg1'), t('qaSugg2'), t('qaSugg3'), t('qaSugg4')]
      const qaPanel = h('section', { key: 'qa', className: 'bsx-card', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', {},
          h('div', { className: 'bsx-card-title' }, t('qaTitle')),
          h('div', { className: 'bsx-hint', style: { marginTop: 4 } }, t('qaHint')),
        ),
        h('div', { className: 'bsx-qa' },
          messages.length === 0
            ? h('div', { className: 'bsx-sugg' }, suggestions.map((prompt) => h('button', {
              key: prompt,
              type: 'button',
              className: 'bsx-chip',
              onClick: () => ask(prompt),
            }, prompt)))
            : messages.map((message, index) => h('div', {
              key: index,
              className: `bsx-msg ${message.role}${message.error === true ? ' error' : ''}`,
            }, message.pending === true ? t('thinking') : message.text)),
        ),
        h('div', { className: 'bsx-row', style: { alignItems: 'flex-end' } },
          h('textarea', {
            className: 'bsx-textarea',
            style: { minHeight: 44, fontFamily: 'inherit', flex: 1 },
            value: question,
            placeholder: t('qaPlaceholder'),
            onChange: (event) => setQuestion(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                ask()
              }
            },
          }),
          h('button', { className: 'bsx-btn primary', type: 'button', disabled: busy === 'ask' || question.trim() === '', onClick: () => ask() },
            busy === 'ask' ? t('thinking') : t('send')),
        ),
      )

      const tabs = [
        ['data', t('tabData')],
        ['rules', t('tabRules')],
        ['qa', t('tabQa')],
      ].map(([value, label]) => h('button', {
        key: value,
        type: 'button',
        className: `bsx-tab${tab === value ? ' active' : ''}`,
        onClick: () => setTab(value),
      }, label))

      return h('div', { className: 'bsx-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('input', { ref: fileRef, type: 'file', accept: '.xlsx,.csv,.tsv,.txt,.json', style: { display: 'none' }, onChange: onFileChange }),
        h('header', { className: 'bsx-head' },
          h('div', { className: 'bsx-title' }, t('title'), h('span', { className: 'bsx-tag' }, t('tagline'))),
          h('div', { className: 'bsx-tabs', style: { borderBottom: 'none' } }, tabs),
          h('div', { className: 'bsx-head-actions' },
            h('button', { className: 'bsx-btn small', type: 'button', disabled: busy !== '', onClick: () => fileRef.current?.click() }, busy === 'file' ? t('importing') : t('pickFileShort')),
            h('button', { className: `bsx-btn small${historyOpen ? ' primary' : ''}`, type: 'button', onClick: toggleHistory }, t('historyButton')),
            h('button', { className: 'bsx-btn small', type: 'button', disabled: busy !== '', onClick: doSample }, t('sample')),
            h('button', { className: 'bsx-btn small', type: 'button', disabled: busy !== '', onClick: doReset }, t('reset')),
          ),
        ),
        h('div', { className: 'bsx-body' },
          h('div', { className: 'bsx-stats' },
            statCard('statTotal', counts.total, ''),
            statCard('statPassed', counts.passed, 'passed'),
            statCard('statRejected', counts.rejected, 'rejected'),
            statCard('statReview', counts.review, 'review'),
            statCard('statPending', counts.pending, 'pending'),
            statCard('statFailed', counts.failed ?? 0, 'failed'),
          ),
          error === '' ? null : h('div', { className: 'bsx-alert' }, error),
          tab === 'data' ? (historyOpen ? historyPanel : dataPanel) : tab === 'rules' ? rulesPanel : qaPanel,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // The slot component renders outside this closure; hand it the service.
        localeService = ctx.locale
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'book-select: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'book-select: en dictionary')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'book-select',
          order: 20,
          label: () => ctx.locale.bind(NS)('viewLabel'),
        }, BookSelectIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'book-select',
        }, BookSelectView))
      },
    }
  },
})
