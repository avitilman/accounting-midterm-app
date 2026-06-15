const SHEET_NAME = 'Submissions';

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ensureHeader(sheet);

  payload.answers.forEach(answer => {
    sheet.appendRow([
      new Date(payload.submittedAt),
      payload.submissionId,
      payload.name,
      payload.studentId,
      payload.score,
      payload.total,
      payload.percent,
      JSON.stringify(payload.selectedSets),
      payload.topicOrder.join(' > '),
      answer.order,
      answer.topicTitle,
      answer.setId,
      answer.questionId,
      answer.prompt,
      answer.selectedText,
      answer.correctText,
      answer.isCorrect,
      JSON.stringify(answer.optionOrder)
    ]);
  });

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow([
    'submittedAt',
    'submissionId',
    'name',
    'studentId',
    'score',
    'total',
    'percent',
    'selectedSets',
    'topicOrder',
    'questionOrder',
    'topic',
    'setId',
    'questionId',
    'prompt',
    'selectedText',
    'correctText',
    'isCorrect',
    'optionOrder'
  ]);
}
