const inputItems = $input.all();

if (inputItems.length === 0) {
  return [{ "json": { "message": "No response" } }];
}

const item = inputItems[0].json;
let outputObj;
try {
  let cleanOutput = item.output.replace(/\r?\n|\r/g, '');
  outputObj = JSON.parse(cleanOutput);
} catch (err) {
  console.error("JSON parse error:", err);
  return [{ "json": { "error": "Invalid output JSON string" } }];
}

let resultPassed = outputObj.passed || [];
let resultRejected = outputObj.rejected || [];
let resultReview = outputObj.review || [];

console.log("AI结果解析: passed=" + resultPassed.length + ", rejected=" + resultRejected.length + ", review=" + resultReview.length);

// 返回三类数据，用于分别更新Data Table
return [
  { json: { type: 'passed', books: resultPassed } },
  { json: { type: 'rejected', books: resultRejected } },
  { json: { type: 'review', books: resultReview } }
];