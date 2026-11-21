const staticData = $getWorkflowStaticData("global");
const passedCount = staticData.passedCount || 0;
const rejectedCount = staticData.rejectedCount || 0;
const reviewCount = staticData.reviewCount || 0;
const processedBatches = staticData.processedBatches || [];

return [{ json: {
  passedCount: passedCount,
  rejectedCount: rejectedCount,
  reviewCount: reviewCount,
  processedBatches: processedBatches.length,
  totalBatches: processedBatches.length,
  message: "分批处理完成"
} }];