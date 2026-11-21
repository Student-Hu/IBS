const staticData = $getWorkflowStaticData("global");
const batchIndex = $("分批处理").context.currentRunIndex;
const items = $input.all();

if (items.length === 0 || batchIndex === undefined) {
    return [{json: {"error": "itemsLength: "+ items.length + " batchIndex: " + batchIndex}}];
}

const booksJson = items.map(item => item.json);
return [{ json: { books: booksJson} }];