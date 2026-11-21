/**
 * Selection rules for the academic-library acquisition workflow.
 *
 * Two layers, exactly as the source n8n workflow ("图书馆图书采购筛选工作流") does it:
 *   1. deterministic prefilter (rules 1/2/3 and the keyword list) — no model involved;
 *   2. semantic screening by the model with {@link AI_RULES} as the policy.
 *
 * The text below is carried over from `doc/extracted/AIPROMPT_Message a model.md`
 * and `doc/extracted/预过滤.js`; rule numbers are kept as the workflow wrote them
 * (content rules jump from 12 to 15) so model output stays comparable with the
 * historical rejection reasons.
 */

/** I-class publishers whose literature titles survive the hard prefilter. */
export const I_CLASS_WHITELIST = [
  '人民文学出版社',
  '作家出版社',
  '作家出版社有限公司',
  '广西师范大学出版社',
  '百花文艺出版社',
  '新星出版社',
  '青岛出版社、新世界出版社',
  '北京联合出版公司',
  '江苏凤凰文艺出版社',
  '长江出版社',
  '中译出版社',
  '商务印书馆',
  '译林出版社',
  '中华书局',
  '北京大学出版社',
]

/** Substring blacklist matched against `书名 + 内容简介`. */
export const BANNED_KEYWORDS = [
  '心灵鸡汤', '励志成功', '情商课', '说话之道', '速成指南', '七天学会', '零基础速成',
  '一本书读懂', '看穿', '看透', '从0到1', '年入百万', '财富密码', '赚钱秘籍',
  '育儿经', '孕产妇', '胎教', '水产养殖', '养殖技术', '汽修', '美容美发',
  '认知升级', '思维模型', '商业思维', '变现', '流量', '自媒体',
  '一本通', '大全集', '合集', '精华', '干货', '秘籍', '宝典',
  '考研', '考公', '公务员', '事业单位', '教师资格证', '注册会计师',
  '风水', '算命', '星座', '塔罗', '占卜', '玄学', '日本', '佛', '词典',
  'Vol', '作品集', '艺术集', '考古', '易学', '道学', '丧葬',
]

/** The five deterministic rules, in the order the prefilter applies them. */
export const PREFILTER_RULES = [
  {
    id: 'pages',
    title: '页码小于 20 页',
    detail: '页码字段以“页”结尾且数值 ≤ 20 时排除；字段缺失或不是“N页”形式的文本一律放行',
    reason: '图书页码小于20',
  },
  {
    id: 'price',
    title: '定价高于 500 元',
    detail: '单册定价 > 500 元的一律排除，用于过滤大型套书与高价专著',
    reason: '规则二-1：图书定价>500元',
  },
  {
    id: 'reprint',
    title: '影印版',
    detail: '版次字段包含“影印”即排除（影印版 / 影印本）',
    reason: '规则二-3：版次为影印版/影印本',
  },
  {
    id: 'literature',
    title: 'I 类文学且出版社不在白名单',
    detail: '分类号以 I 开头、且出版社不属于 15 家文学类白名单出版社时排除',
    reason: '规则二-2：I类分类号且出版社不在白名单',
  },
  {
    id: 'keyword',
    title: '敏感词提示（不再直接排除）',
    detail: '在“书名 + 内容简介”中匹配下列词。命中只作为“预筛提示”交给模型，由模型按图书实际内容判断，不再按词直接排除',
    reason: '关键词提示：命中"X"，由模型按内容判断',
  },
]

/** Per-class guidance from section 三 of the prompt. */
export const CLASS_RULES = [
  {
    code: 'A',
    text: '有关马克思主义著作，仅保留人民出版社、商务印书馆、中华书局、北京大学出版社、中国人民大学出版社出版的 A 类学术著作。',
  },
  {
    code: 'B',
    text: '排除心灵鸡汤类、宗教类图书、论语、庄子、孟子、道德经，仅保留商务印书馆、人民出版社、科学出版社。',
  },
  {
    code: 'D',
    text: '排除党建相关材料、官方政策读本。保留政治哲学、政治思想史、国际关系理论、法学理论等学术著作。',
  },
  {
    code: 'G',
    text: '排除法语、德语、波斯语、劳动教育、大学生心理健康、高校学生工作、教学研究、创新创业、其他高校的内容、太极拳、八段锦等主题图书、排除 G250-279 的图书、排除体育教学类、排除信息管理类；保留科学出版社、中华书局、商务印书馆等出版社的图书。',
  },
  { code: 'I', text: '排除诗集、网络文学、同人文、爽文。' },
  {
    code: 'J',
    text: '排除音乐类图书、排除摄影主题图书、排除书法类（仅保留商务印书馆、科学出版社、中华书局出版社）。',
  },
  { code: 'K', text: '排除具体到城市/区县/乡镇等极小区域的地方史、地理志、乡土资料。' },
  { code: 'F', text: '删除直播、直播运营、市场营销、跨境电商、会计、审计、财务、税务、股市等主题相关图书。' },
  {
    code: 'H',
    text: '删除法语、德语、西班牙语、俄语等外语图书；只保留中文、英语、日语三种语言类图书，但是排除地方语言类图书；删除词典、手册。',
  },
]

/** Section 四: content-based exclusions. `n` keeps the workflow's numbering. */
export const CONTENT_RULES = [
  { n: 1, text: '连续出版物 — 期刊、杂志、年鉴、辑刊、以“第X辑/第X期/年度报告”形式连续出版的文集、资料汇编。' },
  { n: 2, text: 'xxx学史类研究 — 例如：民俗学史研究。' },
  { n: 3, text: '纯军事/警政实务 — 以军事作战、武器装备、警察业务、安防技战术、军警实操为核心内容的图书。' },
  { n: 4, text: '中小学阶段教材教辅 — 面向幼儿、小学、初中、高中的课本、练习册、习题集、同步辅导、考试复习、中考高考类用书。' },
  { n: 5, text: '图情档专业实务手册 — 图书馆、档案馆、博物馆的内部工作规范、业务流程、操作指南、管理手册。' },
  { n: 6, text: '专业临床医学内容 — 临床诊疗、手术操作、专科医学理论、医学检验、专业医技类图书；保留：大众健康科普、基础生理知识、常见病预防类图书。' },
  { n: 7, text: '高度专业金融实务 — 农村金融、保险精算、养老保险运营、信贷实操、金融工程应用等高度应用化内容。' },
  { n: 8, text: '单一高校校史/校情研究 — 仅针对某一所大学的校史、校园文化、校情总结，无高等教育通用学术价值。' },
  { n: 9, text: '小众地方文化研究 — 仅聚焦区县/乡镇/村落等极小地域、冷门乡土、小众民俗，缺乏通识价值与普遍学术意义。' },
  { n: 10, text: '论文集 — 排除所有论文集。' },
  { n: 11, text: '过专过窄的“XXX研究” — 书名以“研究”结尾，但主题过于冷僻、狭窄、非主流；不排除：经典作家、重要思想家、重大历史事件、核心哲学/文学/史学命题研究。' },
  { n: 12, text: '日本通俗流行读物 — 以日本旅游、动漫、偶像、流行文化、生活技巧、美食、时尚为主，无学术与通识价值。' },
  { n: 15, text: '自媒体 — 自媒体作者拼凑的“知识合集”“干货大全”“一本通”“精华集”类图书。' },
  { n: 16, text: '成功学变种口水书 — “认知升级”“思维模型”“底层逻辑”“商业思维”“变现”“流量”类无实质学术内容的图书。' },
  { n: 17, text: '纯图片集 — 无实质性文字内容、仅为图片堆砌的“图鉴”“画册”“摄影集”。' },
  { n: 18, text: '商业传记类 — 企业传记、企业家自传、商业成功案例（非学术研究类）。' },
  { n: 19, text: '职业考试辅导书 — 考研、考公、司法、事业单位、教师资格证、注册会计师等各类职业资格考试辅导用书。' },
  { n: 20, text: '玄学迷信类 — 风水、算命、星座、塔罗、占卜、玄学类图书。' },
  { n: 21, text: '纯习题集 — 纯习题集、试题库、试卷汇编（非教材配套的教学用书）。' },
  { n: 22, text: '行业报告类 — 各类行业报告、白皮书、年度报告（非学术研究类）。' },
  { n: 23, text: '宗教佛学类、道学易学类。' },
  { n: 24, text: '2024 年及以前的书籍只保留科学出版社、中信出版集团、中华书局等出版社的图书或者林业类图书。' },
  { n: 25, text: '所有年鉴、地方志。' },
  { n: 26, text: '大学生职业生涯规划、就业指导、就业创业类图书。' },
]

/**
 * The screening policy handed to the model as its system prompt: the workflow's
 * section 一/二/三/四 verbatim, plus the output contract of section 五 with an
 * explicit "JSON only" instruction.
 */
export const AI_RULES = `高校图书馆中文图书采购筛选规则
一、核心定位与总原则

你是高校图书馆中文图书采购专职筛选员，唯一目标是筛选出适合大学生学习与参考的好图书。

• 执行宽进严出：疑似有学术价值但边界模糊的图书，一律先保留，不轻易排除；
• 分类号作辅助线索，以实际内容价值为准
• 所有判断必须严格依据本规则，不得加入任何个人主观偏好，不要自己发挥

二、固定执行流程 **重要**

1. 执行分类号内容判断规则
2. 执行内容排除规则
3. 结合出版社优先级给出最终结论
4. 对无法明确判定的图书，列入待复审列表

三、按分类号的内容判断规则

A类：有关马克思主义著作，仅保留人民出版社、商务印书馆、中华书局、北京大学出版社、中国人民大学出版社出版的A类学术著作。
B类：排除心灵鸡汤类、宗教类图书、论语、庄子、孟子、道德经，仅保留商务印书馆、人民出版社、科学出版社。
D类：排除党建相关材料、官方政策读本。保留政治哲学、政治思想史、国际关系理论、法学理论等学术著作
G类：排除法语、德语、波斯语、劳动教育、大学生心理健康、高校学生工作、教学研究、创新创业、其他高校的内容、太极拳、八段锦等主题图书、排除G250-279的图书、排除体育教学类、排除信息管理类; 保留科学出版社、中华书局、商务印书馆等出版社的图书。
I类：排除诗集、网络文学、同人文、爽文。
J类：排除音乐类图书、排除摄影主题图书、排除书法类(仅保留商务印书馆、科学出版社、中华书局出版社)。
K类：排除具体到城市/区县/乡镇等极小区域的地方史、地理志、乡土资料。
F类：删除直播、直播运营、市场营销、跨境电商、会计、审计、财务、税务、股市等主题相关图书。
H类：删除法语、德语、西班牙语、俄语等外语图书; 只保留中文、英语、日语三种语言类图书, 但是排除地方语言类图书；删除词典、手册。

四、内容排除规则（大模型语义精准判断·满足任意一条即排除）

1. 连续出版物 - 期刊、杂志、年鉴、辑刊、以"第X辑/第X期/年度报告"形式连续出版的文集、资料汇编。
2. xxx学史类研究 - 例如：民俗学史研究。
3. 纯军事/警政实务 - 以军事作战、武器装备、警察业务、安防技战术、军警实操为核心内容的图书。
4. 中小学阶段教材教辅 - 面向幼儿、小学、初中、高中的课本、练习册、习题集、同步辅导、考试复习、中考高考类用书。
5. 图情档专业实务手册 - 图书馆、档案馆、博物馆的内部工作规范、业务流程、操作指南、管理手册。
6. 专业临床医学内容 - 临床诊疗、手术操作、专科医学理论、医学检验、专业医技类图书；保留：大众健康科普、基础生理知识、常见病预防类图书。
7. 高度专业金融实务 - 农村金融、保险精算、养老保险运营、信贷实操、金融工程应用等高度应用化内容。
8. 单一高校校史/校情研究 - 仅针对某一所大学的校史、校园文化、校情总结，无高等教育通用学术价值。
9. 小众地方文化研究 - 仅聚焦区县/乡镇/村落等极小地域、冷门乡土、小众民俗，缺乏通识价值与普遍学术意义。
10. 论文集 - 排除所有论文集。
11. 过专过窄的"XXX研究" - 书名以"研究"结尾，但主题过于冷僻、狭窄、非主流；不排除：经典作家、重要思想家、重大历史事件、核心哲学/文学/史学命题研究。
12. 日本通俗流行读物 - 以日本旅游、动漫、偶像、流行文化、生活技巧、美食、时尚为主，无学术与通识价值。
15. 自媒体 - 自媒体作者拼凑的"知识合集""干货大全""一本通""精华集"类图书。
16. 成功学变种口水书 - "认知升级""思维模型""底层逻辑""商业思维""变现""流量"类无实质学术内容的图书。
17. 纯图片集 - 无实质性文字内容、仅为图片堆砌的"图鉴""画册""摄影集"。
18. 商业传记类 - 企业传记、企业家自传、商业成功案例（非学术研究类）。
19. 职业考试辅导书 - 考研、考公、司法、事业单位、教师资格证、注册会计师等各类职业资格考试辅导用书。
20. 玄学迷信类 - 风水、算命、星座、塔罗、占卜、玄学类图书。
21. 纯习题集 - 纯习题集、试题库、试卷汇编（非教材配套的教学用书）。
22. 行业报告类 - 各类行业报告、白皮书、年度报告（非学术研究类）。
23. 宗教佛学类,道学易学类
24. 2024年及以前的书籍只保留科学出版社、中信出版集团、中华书局等出版社的图书或者林业类图书
25. 所有年鉴、地方志
26. 大学生职业生涯规划、就业指导、就业创业类图书

五、关于"预筛提示"字段

输入图书中若带有"预筛提示"，表示其书名或内容简介里出现了敏感词（如 日本、佛、考古、精华、心灵鸡汤、看透）。请忽略关键词本身，按图书的实际主题与内容判断：
• 综述里把日本列为案例、政治思想史里提到考古材料的学术专著，不因该词排除；
• 简介里写"拒绝心灵鸡汤"的图书，不因该词排除；
• 只有当图书确实属于第四节所列类型时，才排除并写明"规则第X条 + 具体依据"。

六、输出要求

只输出一个 JSON 对象，不要输出任何解释文字，不要使用代码块围栏，字段名必须完全一致：
{"passed": [], "rejected": [], "review": []}

• passed 数组每项：{ "序号":"XXX", "题名":"XXX", "通过理由":"" }
• rejected 数组每项：{ "序号":"XXX", "题名":"XXX", "排除原因":"规则第X条 + 具体依据" }
• review 数组每项：{ "序号":"XXX", "题名":"XXX", "待复审原因":"[信息不足/边界模糊/疑似优质边缘图书]" }

每本输入图书必须且只能出现在 passed、rejected、review 三个数组中的一个。`

/**
 * Page-count predicate of the workflow: only a "<N>页" string is judged, and
 * anything else (missing field, free text, ranges) passes.
 * @param {unknown} pageStr - raw pagination field.
 * @returns {boolean} false only when the field is a "<N>页" string with N ≤ 20.
 */
export function isPagesGreaterThan20(pageStr) {
  if (!pageStr || typeof pageStr !== 'string') return true
  const trimmed = pageStr.trim()
  if (!trimmed.endsWith('页')) return true
  const numWithComma = trimmed.slice(0, -1).replace(/[^0-9,]/g, '')
  if (numWithComma.length === 0) return true
  const pages = parseInt(numWithComma.replace(/,/g, ''), 10)
  return !Number.isNaN(pages) && pages > 20
}

/**
 * Keywords present in the title or the blurb. They no longer reject a book:
 * a blurb can mention 日本 as a case study, or say it rejects 心灵鸡汤. The hit
 * is passed to the model as a hint so it judges the content, not the word.
 * @param {object} book - normalized book.
 * @returns {string} human readable hint, '' when nothing matched.
 */
export function keywordHintOf(book) {
  const haystack = String(book.title || '') + String(book.summary || '')
  const hits = BANNED_KEYWORDS.filter((keyword) => haystack.includes(keyword))
  if (hits.length === 0) return ''
  return `书名或内容简介出现敏感词：${hits.slice(0, 6).join('、')}`
}

/**
 * Apply the deterministic rules to one normalized book. Only structured fields
 * are used, so the outcome is reproducible; wording-based decisions belong to
 * the model.
 * @param {object} book - normalized book (`价格/出版社/分类号/版次/页码`).
 * @returns {string|null} rejection reason, or null when the book needs the model.
 */
export function prefilterBook(book) {
  if (!isPagesGreaterThan20(book.pages)) return '图书页码小于20'
  if (book.price > 500) return '规则二-1：图书定价>500元'
  if (String(book.edition || '').includes('影印')) return '规则二-3：版次为影印版/影印本'
  const cls = String(book.cls || '')
  if (cls.startsWith('I') && !I_CLASS_WHITELIST.includes(book.publisher)) {
    return '规则二-2：I类分类号且出版社不在白名单'
  }
  return null
}

/**
 * Split a book list into the rule-rejected tail and the model-bound head, and
 * attach the keyword hint every model-bound book may carry.
 * @param {object[]} books - normalized books; mutated in place with status/reason/hint.
 * @returns {{rejected: object[], needsAI: object[]}}
 */
export function prefilterBooks(books) {
  const rejected = []
  const needsAI = []
  for (const book of books) {
    const hint = keywordHintOf(book)
    book.hint = hint
    const reason = prefilterBook(book)
    if (reason === null) {
      book.status = 'pending'
      book.reason = ''
      book.source = ''
      needsAI.push(book)
    } else {
      book.status = 'rejected'
      book.reason = reason
      book.source = 'rule'
      rejected.push(book)
    }
  }
  return { rejected, needsAI }
}

/** Count how many books each prefilter rule would reject (for the rules panel). */
export function countPrefilterHits(books) {
  const counts = { pages: 0, price: 0, reprint: 0, literature: 0, keyword: 0 }
  for (const book of books) {
    const reason = prefilterBook(book)
    if (reason === null) {
      if (keywordHintOf(book) !== '') counts.keyword++
      continue
    }
    if (reason.startsWith('图书页码')) counts.pages++
    else if (reason.startsWith('规则二-1')) counts.price++
    else if (reason.startsWith('规则二-3')) counts.reprint++
    else if (reason.startsWith('规则二-2')) counts.literature++
  }
  return counts
}
