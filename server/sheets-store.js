import { google } from 'googleapis';
import path from 'node:path';
import { loadQuestionSeed } from './question-seed.js';

const QUESTIONS_HEADERS = [
  'QuestionID', 'Version', 'CategoryCode', 'CategoryName', 'Rule', 'Confidence',
  'QuestionText', 'Status', 'Source', 'ParentQuestionID', 'UpdatedAt'
];
const ISSUE_HEADERS = [
  'RecordID', 'RecordType', 'ReviewID', 'ProjectID', 'ProjectName', 'ReviewDate',
  'IssueID', 'IssueVersion', 'IssueTitle', 'IssueDescription', 'IssueCategoryID',
  'IssueCategoryName', 'Priority', 'Status', 'UpdatedAt', 'CapturedAt', 'UpdateNote',
  'ReportVersion', 'ReportText', 'ReviewMetadataJSON', 'QuestionMetadataJSON'
];

const text = value => value === null || value === undefined ? '' : String(value);
const normalize = value => text(value).replace(/\s+/g, ' ').trim().toLowerCase();
const quoteSheet = name => `'${text(name).replace(/'/g, "''")}'`;
const questionKey = question => `${text(question.questionId || question.id).replace(/@\d+$/, '')}@${Number(question.version || text(question.id).match(/@(\d+)$/)?.[1] || 1)}`;
const questionHeader = question => `Q:${questionKey(question)} | ${text(question.text || question.q).replace(/[\r\n]+/g, ' ').trim()}`;
const parseQuestionKey = header => text(header).match(/^Q:([^|]+?)\s*\|/)?.[1]?.trim() || '';

function rowObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
}

function safeJson(value, fallback) {
  try { return JSON.parse(text(value)); }
  catch { return fallback; }
}

function columnName(index) {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function mergeConcurrentQuestions(incoming = [], existing = []) {
  const existingByKey = new Map(existing.map(question => [questionKey(question), question]));
  const merged = incoming.map(question => {
    const prior = existingByKey.get(questionKey(question));
    if (!prior?.answer) return question;
    const incomingTime = Date.parse(question.answerUpdatedAt || '') || 0;
    const priorTime = Date.parse(prior.answerUpdatedAt || '') || 0;
    if (!question.answer || priorTime > incomingTime) {
      return { ...question, answer: prior.answer, answerStatus: prior.answerStatus || '', answerUpdatedAt: prior.answerUpdatedAt || '' };
    }
    return question;
  });
  const incomingKeys = new Set(merged.map(questionKey));
  for (const prior of existing) {
    if (!incomingKeys.has(questionKey(prior)) && (prior.answer || prior.source === 'ai')) merged.push(prior);
  }
  return merged;
}

export function createSheetsStore({ spreadsheetId, issuesSheet = 'Issues', questionsSheet = 'Questions', modelDataFile }) {
  if (!spreadsheetId) throw new Error('REVIEW_SPREADSHEET_ID 未配置。');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const questionsRange = `${quoteSheet(questionsSheet)}!A:K`;
  const issuesRange = `${quoteSheet(issuesSheet)}!A:ZZ`;
  let questionCache = null;

  async function ensureTabs() {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties)' });
    const titles = new Set((metadata.data.sheets || []).map(sheet => sheet.properties?.title));
    const missing = [issuesSheet, questionsSheet].filter(name => !titles.has(name));
    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: title === issuesSheet ? 200 : 20 } } } })) }
      });
    }
  }

  async function ensureQuestions() {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: questionsRange });
    const rows = response.data.values || [];
    if (!rows.length || !rows[0]?.some(Boolean)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(questionsSheet)}!A1:K1`,
        valueInputOption: 'RAW',
        requestBody: { values: [QUESTIONS_HEADERS] }
      });
    } else if (QUESTIONS_HEADERS.some((header, index) => rows[0][index] !== header)) {
      throw new Error(`工作表 ${questionsSheet} 的列结构不兼容，请保留：${QUESTIONS_HEADERS.join('、')}`);
    }
    if (rows.length <= 1) {
      const seed = await loadQuestionSeed(modelDataFile);
      const now = new Date().toISOString();
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: questionsRange,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: seed.map(question => [
          question.questionId, question.version, question.categoryCode, question.categoryName,
          question.rule, question.confidence, question.text, question.status, question.source,
          question.parentQuestionId, now
        ]) }
      });
    }
    questionCache = null;
  }

  async function listQuestions({ fresh = false } = {}) {
    if (questionCache && !fresh) return structuredClone(questionCache);
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: questionsRange });
    const rows = response.data.values || [];
    const questions = rows.slice(1).map(row => rowObject(QUESTIONS_HEADERS, row)).filter(row => row.QuestionID && row.QuestionText).map(row => ({
      questionId: text(row.QuestionID).trim(),
      version: Number(row.Version || 1),
      id: `${text(row.QuestionID).trim()}@${Number(row.Version || 1)}`,
      category: text(row.CategoryCode).trim(),
      categoryName: text(row.CategoryName).trim(),
      rule: text(row.Rule).trim(),
      confidence: text(row.Confidence).trim(),
      q: text(row.QuestionText).trim(),
      status: text(row.Status || 'active').trim().toLowerCase(),
      sourceLabel: text(row.Source).trim(),
      parentQuestionId: text(row.ParentQuestionID).trim()
    })).filter(question => question.status === 'active');
    const latest = new Map();
    for (const question of questions) {
      const prior = latest.get(question.questionId);
      if (!prior || question.version > prior.version) latest.set(question.questionId, question);
    }
    questionCache = [...latest.values()].sort((a, b) => a.category.localeCompare(b.category) || a.questionId.localeCompare(b.questionId, undefined, { numeric: true }));
    return structuredClone(questionCache);
  }

  async function ensureIssuesHeaders(questions = []) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quoteSheet(issuesSheet)}!1:1` });
    let headers = response.data.values?.[0] || [];
    if (!headers.some(Boolean)) {
      headers = [...ISSUE_HEADERS];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(issuesSheet)}!A1:${columnName(headers.length - 1)}1`,
        valueInputOption: 'RAW', requestBody: { values: [headers] }
      });
    } else if (ISSUE_HEADERS.some((header, index) => headers[index] !== header)) {
      throw new Error(`工作表 ${issuesSheet} 的前 ${ISSUE_HEADERS.length} 列结构不兼容。`);
    }
    const existingKeys = new Set(headers.map(parseQuestionKey).filter(Boolean));
    const missingHeaders = questions.filter(question => !existingKeys.has(questionKey(question))).map(questionHeader);
    if (missingHeaders.length) {
      const start = headers.length;
      headers = [...headers, ...missingHeaders];
      const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)' });
      const issueTab = (metadata.data.sheets || []).find(sheet => sheet.properties?.title === issuesSheet);
      const columnCount = Number(issueTab?.properties?.gridProperties?.columnCount || 0);
      if (issueTab?.properties?.sheetId !== undefined && columnCount < headers.length) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: issueTab.properties.sheetId, gridProperties: { columnCount: Math.max(headers.length, columnCount + 50) } }, fields: 'gridProperties.columnCount' } }] }
        });
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(issuesSheet)}!${columnName(start)}1:${columnName(headers.length - 1)}1`,
        valueInputOption: 'RAW', requestBody: { values: [missingHeaders] }
      });
    }
    return headers;
  }

  function metadataFor(review) {
    return JSON.stringify({
      reviewStatus: review.reviewStatus || 'in_progress',
      modelVersion: review.modelVersion || 'v0.2',
      issueCategories: Array.isArray(review.issueCategories) ? review.issueCategories : [],
      hiddenIssueIds: Array.isArray(review.hiddenIssueIds) ? review.hiddenIssueIds : [],
      activeIssueId: review.activeIssueId || null,
      createdAt: review.createdAt || ''
    });
  }

  function issueRow(headers, review, issue, recordType, recordId, now) {
    const isHistory = recordType === 'history';
    const version = Number(issue.version || 0);
    const report = issue.report && typeof issue.report === 'object' ? issue.report : {};
    const questions = Array.isArray(issue.questions) ? issue.questions : [];
    const questionMeta = questions.map(question => ({
      key: questionKey(question), questionId: text(question.questionId || question.id).replace(/@\d+$/, ''),
      version: Number(question.version || text(question.id).match(/@(\d+)$/)?.[1] || 1),
      q: question.q || '', category: question.category || '', categoryName: question.categoryName || '',
      rule: question.rule || '', confidence: question.confidence || '', skipped: Boolean(question.skipped),
      gap: Boolean(question.gap), source: question.source || 'library',
      answerStatus: question.answerStatus || '', answerUpdatedAt: question.answerUpdatedAt || ''
    }));
    const fixed = {
      RecordID: recordId, RecordType: recordType, ReviewID: review.reviewId,
      ProjectID: review.projectId, ProjectName: review.project, ReviewDate: review.date,
      IssueID: issue.issueId || issue.id || '', IssueVersion: version,
      IssueTitle: issue.title || '', IssueDescription: issue.text || '',
      IssueCategoryID: issue.categoryId || '', IssueCategoryName: issue.categoryName || '',
      Priority: issue.priority || '', Status: issue.status || '', UpdatedAt: now,
      CapturedAt: isHistory ? issue.capturedAt || '' : '', UpdateNote: isHistory ? issue.updateNote || '' : '',
      ReportVersion: Number(report.version || 0), ReportText: report.text || '',
      ReviewMetadataJSON: metadataFor(review), QuestionMetadataJSON: JSON.stringify(questionMeta)
    };
    const answers = new Map(questions.map(question => [questionKey(question), question.answer || '']));
    return headers.map(header => header.startsWith('Q:') ? answers.get(parseQuestionKey(header)) || '' : fixed[header] ?? '');
  }

  function reviewRow(headers, review, now) {
    const fixed = {
      RecordID: `review:${review.reviewId}`, RecordType: 'review', ReviewID: review.reviewId,
      ProjectID: review.projectId, ProjectName: review.project, ReviewDate: review.date,
      UpdatedAt: now, ReviewMetadataJSON: metadataFor(review)
    };
    return headers.map(header => fixed[header] ?? '');
  }

  async function readIssueGrid() {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: issuesRange });
    const values = response.data.values || [];
    return { headers: values[0] || [], rows: values.slice(1) };
  }

  async function upsertRows(headers, records) {
    const grid = await readIssueGrid();
    const idIndex = headers.indexOf('RecordID');
    const rowById = new Map(grid.rows.map((row, index) => [text(row[idIndex]), index + 2]).filter(([id]) => id));
    const updates = [], appends = [];
    for (const record of records) {
      const rowNumber = rowById.get(record[0]);
      if (rowNumber) updates.push({ range: `${quoteSheet(issuesSheet)}!A${rowNumber}:${columnName(headers.length - 1)}${rowNumber}`, values: [record] });
      else appends.push(record);
    }
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: updates } });
    if (appends.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: issuesRange, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: appends } });
  }

  function parseIssue(headers, row) {
    const value = rowObject(headers, row);
    const meta = safeJson(value.QuestionMetadataJSON, []);
    const questions = meta.map(question => ({
      id: question.key || `${question.questionId}@${question.version || 1}`,
      questionId: question.questionId, version: Number(question.version || 1), q: question.q || '',
      category: question.category || '', categoryName: question.categoryName || '', rule: question.rule || '',
      confidence: question.confidence || '', answer: row[headers.findIndex(header => parseQuestionKey(header) === question.key)] || '',
      answerStatus: question.answerStatus || '', answerUpdatedAt: question.answerUpdatedAt || '',
      skipped: Boolean(question.skipped), gap: Boolean(question.gap), source: question.source || 'library'
    }));
    const issue = {
      id: value.IssueID, issueId: value.IssueID, title: value.IssueTitle,
      text: value.IssueDescription, categoryId: value.IssueCategoryID,
      categoryName: value.IssueCategoryName, priority: value.Priority, status: value.Status,
      questions, questionIndex: 0
    };
    if (Number(value.ReportVersion || 0) || value.ReportText) issue.report = { version: Number(value.ReportVersion || 1), text: value.ReportText, updatedAt: value.UpdatedAt };
    if (value.RecordType === 'history') Object.assign(issue, { snapshotId: value.RecordID.replace(/^history:/, ''), version: Number(value.IssueVersion || 1), capturedAt: value.CapturedAt, updateNote: value.UpdateNote });
    return issue;
  }

  async function loadReview(reviewId) {
    const grid = await readIssueGrid();
    const objects = grid.rows.map(row => ({ row, value: rowObject(grid.headers, row) })).filter(item => item.value.ReviewID === reviewId);
    if (!objects.length) throw Object.assign(new Error(`找不到项目记录：${reviewId}`), { statusCode: 404 });
    const reviewRecord = objects.find(item => item.value.RecordType === 'review') || objects[0];
    const meta = safeJson(reviewRecord.value.ReviewMetadataJSON, {});
    return {
      reviewId, projectId: reviewRecord.value.ProjectID, project: reviewRecord.value.ProjectName,
      date: reviewRecord.value.ReviewDate, reviewStatus: meta.reviewStatus || 'in_progress',
      modelVersion: meta.modelVersion || 'v0.2', issueCategories: meta.issueCategories || [],
      hiddenIssueIds: meta.hiddenIssueIds || [], activeIssueId: meta.activeIssueId || null,
      createdAt: meta.createdAt || reviewRecord.value.UpdatedAt,
      issues: objects.filter(item => item.value.RecordType === 'current').map(item => parseIssue(grid.headers, item.row)),
      issueHistory: objects.filter(item => item.value.RecordType === 'history').map(item => parseIssue(grid.headers, item.row))
    };
  }

  async function saveReview(review) {
    if (!review || typeof review !== 'object' || !text(review.reviewId).trim()) throw Object.assign(new Error('Review 数据格式无效。'), { statusCode: 400 });
    try {
      const current = await loadReview(review.reviewId);
      const currentIssues = new Map(current.issues.map(issue => [issue.id, issue]));
      review.issues = (review.issues || []).map(issue => ({
        ...issue,
        questions: mergeConcurrentQuestions(issue.questions || [], currentIssues.get(issue.id)?.questions || [])
      }));
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    const library = await listQuestions();
    const payloadQuestions = [...(review.issues || []), ...(review.issueHistory || [])].flatMap(issue => issue.questions || []);
    const byKey = new Map([...library, ...payloadQuestions].map(question => [questionKey(question), question]));
    const headers = await ensureIssuesHeaders([...byKey.values()]);
    const now = new Date().toISOString();
    const records = [reviewRow(headers, review, now)];
    for (const issue of review.issues || []) records.push(issueRow(headers, review, issue, 'current', `current:${review.reviewId}:${issue.id}`, now));
    for (const snapshot of review.issueHistory || []) records.push(issueRow(headers, review, snapshot, 'history', `history:${snapshot.snapshotId || `${snapshot.issueId || snapshot.id}:${snapshot.version || 1}`}`, now));
    await upsertRows(headers, records);
    return { ok: true, reviewId: review.reviewId, updatedAt: now, issueCount: (review.issues || []).length, historyCount: (review.issueHistory || []).length };
  }

  async function syncQuestions(incoming) {
    if (!Array.isArray(incoming) || !incoming.length) throw Object.assign(new Error('questions 必须是非空数组。'), { statusCode: 400 });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: questionsRange });
    const rows = response.data.values || [];
    const existing = rows.slice(1).map(row => rowObject(QUESTIONS_HEADERS, row));
    const now = new Date().toISOString(), additions = [];
    const knownTexts = new Set(existing.map(row => normalize(row.QuestionText)).filter(Boolean));
    for (const raw of incoming) {
      const body = typeof raw === 'string' ? { text: raw } : raw || {};
      const questionText = text(body.text || body.question).trim();
      if (!questionText) continue;
      const suppliedId = text(body.questionId).trim();
      const normalizedText = normalize(questionText);
      if (knownTexts.has(normalizedText)) continue;
      const id = suppliedId || `Q${Date.now().toString(36).toUpperCase()}${(additions.length + 1).toString().padStart(2, '0')}`;
      const versions = existing.filter(row => row.QuestionID === id).map(row => Number(row.Version || 1));
      const version = versions.length ? Math.max(...versions) + 1 : 1;
      additions.push([id, version, body.categoryCode || 'NEW', body.categoryName || '待分类', body.rule || '', body.confidence || '', questionText, 'active', body.source || '会议提炼', body.parentQuestionId || '', now]);
      knownTexts.add(normalizedText);
    }
    if (additions.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: questionsRange, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: additions } });
    questionCache = null;
    await ensureIssuesHeaders(await listQuestions({ fresh: true }));
    return { ok: true, added: additions.length, skipped: incoming.length - additions.length };
  }

  return {
    databaseFile: `Google Sheets:${spreadsheetId}/${issuesSheet}`,
    async initialize() { await ensureTabs(); await ensureQuestions(); await ensureIssuesHeaders(await listQuestions({ fresh: true })); },
    async getBootstrap() {
      const grid = await readIssueGrid();
      const reviewRecords = grid.rows.map(row => rowObject(grid.headers, row)).filter(row => row.RecordType === 'review');
      return {
        appTitle: 'Review 助手', modelVersion: 'v0.2', storage: 'google-sheets', questions: await listQuestions(),
        reviews: reviewRecords.map(row => ({ reviewId: row.ReviewID, projectId: row.ProjectID, projectName: row.ProjectName, reviewDate: row.ReviewDate, status: safeJson(row.ReviewMetadataJSON, {}).reviewStatus || 'in_progress', updatedAt: row.UpdatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      };
    },
    loadReview,
    saveReview,
    syncQuestions,
    async deleteReview() { throw Object.assign(new Error('为保留 Sheets 历史记录，不支持直接删除 Review。'), { statusCode: 405 }); }
  };
}
