const items = $input.all();
if (items.length === 0) { return []; }
const getField = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) { return obj[k]; }
  }
  return "";
};
const outputItems = [];
for (let i = 0; i < items.length; i++) {
  const row = items[i].json;
  outputItems.push({
    json: {
      序号: getField(row, "serial_no"),
      书名: getField(row, "title"),
      价格: parseFloat(getField(row, "price")) || 0,
      出版社: getField(row, "publisher"),
      ISBN: getField(row, "isbn"),
      责任者: getField(row, "author"),
      出版年: parseInt(getField(row, "publication_year")) || 0,
      分类号: getField(row, "分类号", "classification_no"),
      内容简介: getField(row, "summary"),
      版次: getField(row, "edition") || "",
      页码: getField(row, "pagination")
    }
  });
}
console.log("Code: Output " + outputItems.length + " books");
return outputItems;