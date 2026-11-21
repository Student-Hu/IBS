const items = $input.all();
 const prefilteredRejected = [];

function isPagesGreaterThan20(pageStr) {
    if (!pageStr || typeof pageStr !== 'string') return true;
    const trimmed = pageStr.trim();
    if (!trimmed.endsWith('页')) return true;
    const numPart = trimmed.slice(0, -1);
    const numWithComma = numPart.replace(/[^0-9,]/g, '');
    if (numWithComma.length === 0) return true;
    const numericStr = numWithComma.replace(/,/g, '');
    const pages = parseInt(numericStr, 10);
    return !isNaN(pages) && pages > 20;
}

const iClassWhitelist = [
  '人民文学出版社', '作家出版社', '作家出版社有限公司',
  '广西师范大学出版社', '百花文艺出版社', '新星出版社',
  '青岛出版社、新世界出版社',
  '北京联合出版公司', '江苏凤凰文艺出版社', '长江出版社',
  '中译出版社', '商务印书馆', '译林出版社', '中华书局', '北京大学出版社'
];

const bannedKeywords = [
  '心灵鸡汤', '励志成功', '情商课', '说话之道', '速成指南', '七天学会', '零基础速成',
  '一本书读懂', '看穿', '看透', '从0到1', '年入百万', '财富密码', '赚钱秘籍',
  '育儿经', '孕产妇', '胎教', '水产养殖', '养殖技术', '汽修', '美容美发',
  '认知升级', '思维模型', '商业思维', '变现', '流量', '自媒体',
  '一本通', '大全集', '合集', '精华', '干货', '秘籍', '宝典',
  '考研', '考公', '公务员', '事业单位', '教师资格证', '注册会计师',
  '风水', '算命', '星座', '塔罗', '占卜', '玄学', '日本', '佛', '词典',
  'Vol', '作品集', '艺术集', '考古', '易学', '道学','丧葬'
];

const needsAIFilter = [];

for (const item of items) {
  const book = item.json;
  const bookName = book.书名 || '';
  const description = book.内容简介 || '';
  const publisher = book.出版社 || '';
  const classification = book.分类号 || '';
  const edition = book.版次 || '';
  const price = parseFloat(book.价格) || 0;
  const pagination = (book.页码);

  let rejected = false;
  let rejectReason = '';

  if (!isPagesGreaterThan20(pagination)){
    rejected = true;
    rejectReason = '图书页码小于20';
  }
  else if (price > 500) {
    rejected = true;
    rejectReason = '规则二-1：图书定价>500元';
  }
  else if (edition.includes('影印')) {
    rejected = true;
    rejectReason = '规则二-3：版次为影印版/影印本';
  }
  else if (classification.startsWith('I') && !iClassWhitelist.includes(publisher)) {
    rejected = true;
    rejectReason = '规则二-2：I类分类号且出版社不在白名单';
  }
  else {
    const textToCheck = bookName + description;
    for (const keyword of bannedKeywords) {
      if (textToCheck.includes(keyword)) {
        rejected = true;
        rejectReason = '规则四：关键词"' + keyword + '"命中';
        break;
      }
    }
  }

  if (rejected) {
    prefilteredRejected.push({
      序号: book.序号,
      书名: bookName,
      价格: price,
      出版社: publisher,
      排除原因: rejectReason
    });
    console.log('预过滤排除: ' + bookName + ' - ' + rejectReason);
  } else {
    needsAIFilter.push(item);
  }
}

console.log('预过滤结果: 排除=' + prefilteredRejected.length + ', 待AI判断=' + needsAIFilter.length);

return {json: {"prefilteredRejected": prefilteredRejected, "needsAIFilter": needsAIFilter}};