const $ = selector => document.querySelector(selector);
const $all = selector => [...document.querySelectorAll(selector)];
const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);
const clean = value => (value || '').replace(/^[-*•\d.、\s]+/, '').replace(/\s+/g, ' ').trim();
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
const LAST_REVIEW_KEY = 'jp-last-review-id';
const SYSTEM_THEME_QUERY = window.matchMedia('(prefers-color-scheme: dark)');

function freshState() {
  return {
    reviewId: uid('R'),
    projectId: uid('P'),
    project: 'Review',
    date: today(),
    reviewStatus: 'in_progress',
    modelVersion: DEFAULT_MODEL_VERSION,
    issueCategories: [{ id: 'general', name: '综合', typeId: '' }],
    issueHistory: [],
    hiddenIssueIds: [],
    issues: [],
    activeIssueId: null,
    createdAt: new Date().toISOString()
  };
}

let state = freshState();
let serverReady = false;
let saveTimer = null;
let saveInFlight = null;
let savePending = false;
let questionLibraryFilter = 'all';

function animateSavedFeedback() {
  const feedback = $('#savedFeedback');
  if (!feedback) return;
  feedback.classList.add('visible');
  setTimeout(() => feedback.classList.remove('visible'), 850);
}

function applySystemTheme(event = SYSTEM_THEME_QUERY) {
  document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
}

async function serverCall(method, payload) {
  let url = '';
  let options = { headers: { Accept: 'application/json' } };
  if (method === 'getBootstrap') url = '/api/bootstrap';
  else if (method === 'loadReview') url = `/api/reviews/${encodeURIComponent(payload)}`;
  else if (method === 'saveReview') {
    url = `/api/reviews/${encodeURIComponent(payload.reviewId)}`;
    options = { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) };
  } else throw new Error(`未知的本地服务方法：${method}`);

  const response = await fetch(url, options);
  const text = await response.text();
  let result = {};
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`本地服务返回了无法解析的数据（HTTP ${response.status}）。`); }
  if (!response.ok) throw new Error(result.error || `本地服务请求失败（HTTP ${response.status}）。`);
  return result;
}

function showBanner(message) {
  const banner = $('#serverBanner');
  banner.textContent = message;
  banner.classList.remove('hidden');
}

function hideBanner() { $('#serverBanner').classList.add('hidden'); }

function buildQuestions() {
  return QUESTION_CATEGORIES.flatMap(category => category.questions.map((q, index) => ({
    id: `${category.code}${index + 1}`,
    category: category.code,
    categoryName: category.name,
    rule: category.rule,
    confidence: category.confidence,
    q,
    answer: '',
    skipped: false,
    gap: false,
    source: 'library'
  })));
}

function mergeQuestionLibrary(existing = []) {
  const savedByText = new Map(existing.map(question => [clean(question.q), question]));
  const library = buildQuestions();
  const libraryText = new Set(library.map(question => clean(question.q)));
  const merged = library.map(question => {
    const saved = savedByText.get(clean(question.q));
    return saved ? { ...question, answer: saved.answer || '', skipped: Boolean(saved.skipped), gap: Boolean(saved.gap) } : question;
  });
  existing.filter(question => !libraryText.has(clean(question.q)) && (question.answer || question.gap)).forEach((question, index) => {
    merged.push({
      ...question,
      id: question.id || `X${index + 1}`,
      category: 'X',
      categoryName: '历史已填写问题',
      rule: question.rule || '—',
      confidence: question.confidence || '—'
    });
  });
  return merged;
}

function normalizeSeverity(value) {
  return ({ P0: 'S1', P1: 'S2', P2: 'S3', S1: 'S1', S2: 'S2', S3: 'S3' })[value] || 'S3';
}

function classify(text) { return TYPES.find(type => type.regex.test(text)) || TYPES.at(-1); }

function titleFor(text, type, index) {
  return text.replace(/[，。；;]/, '\n').split('\n')[0].slice(0, 28) || `${TYPES.find(item => item.id === type)?.name || '综合议题'} ${index + 1}`;
}

function buildIssue(text, priority, categoryId) {
  const normalized = clean(text);
  const type = classify(normalized).id;
  return {
    id: uid('I'),
    title: titleFor(normalized, type, state.issues.length),
    text: normalized,
    type,
    priority: normalizeSeverity(priority),
    categoryId,
    manualStatus: '',
    missing: DIMENSIONS.filter(item => !item.regex.test(normalized)).map(item => item.id),
    questions: buildQuestions(),
    questionIndex: 0,
    questionLibraryVersion: QUESTION_LIBRARY_VERSION,
    forcedClosed: false,
    status: '未开始',
    completion: 0,
    createdAt: new Date().toISOString()
  };
}

function ensureState() {
  state = { ...freshState(), ...state };
  state.issueCategories = Array.isArray(state.issueCategories) && state.issueCategories.length ? state.issueCategories : [{ id: 'general', name: '综合', typeId: '' }];
  state.issueHistory = Array.isArray(state.issueHistory) ? state.issueHistory : [];
  state.hiddenIssueIds = Array.isArray(state.hiddenIssueIds) ? state.hiddenIssueIds : [];
  state.issues = Array.isArray(state.issues) ? state.issues : [];
  state.issues.forEach(issue => {
    issue.priority = normalizeSeverity(issue.priority);
    issue.questions = mergeQuestionLibrary(issue.questions);
    issue.questionIndex = Math.max(0, Math.min(Number(issue.questionIndex || 0), issue.questions.length - 1));
    refreshIssue(issue);
  });
  if (!state.issues.some(issue => issue.id === state.activeIssueId)) state.activeIssueId = state.issues[0]?.id || null;
}

function refreshIssue(issue) {
  const total = issue.questions?.length || 0;
  const completed = issue.questions?.filter(question => question.answer || question.skipped).length || 0;
  issue.completion = total ? Math.round(completed / total * 100) : 0;
  issue.status = completed ? (completed === total ? '已完成' : '填写中') : '未开始';
}

function categoryName(id) {
  return state.issueCategories.find(category => category.id === id)?.name || '未分类';
}

function getIssueHistory(issueId) {
  return state.issueHistory.filter(item => (item.issueId || item.id) === issueId).sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
}

function renderCategoryOptions() {
  const select = $('#newIssueCategory');
  const current = select.value;
  select.innerHTML = state.issueCategories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  if (state.issueCategories.some(category => category.id === current)) select.value = current;
}

function renderQueue() {
  const scrollTop = $('#reviewProblemList').scrollTop;
  const rank = { S1: 0, S2: 1, S3: 2 };
  const issues = [...state.issues].sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  $('#reviewCount').textContent = `${issues.length} 个议题`;
  $('#reviewProblemCount').textContent = `${issues.length} 个`;
  $('#reviewProblemList').innerHTML = issues.length ? issues.map((issue, index) => {
    refreshIssue(issue);
    const history = getIssueHistory(issue.id);
    const version = history.length ? `V${history.at(-1).version || history.length}` : '未保存';
    const completed = issue.questions.filter(question => question.answer || question.skipped).length;
    return `<button class="problem-card ${issue.id === state.activeIssueId ? 'active' : ''}" type="button" data-review-issue-id="${escapeHtml(issue.id)}">
      <span class="problem-card-meta"><strong>${escapeHtml(issue.priority)} · ${index + 1}</strong><span>${escapeHtml(categoryName(issue.categoryId))}</span><span class="version">${escapeHtml(version)}</span></span>
      <span class="problem-card-title">${escapeHtml(issue.title || issue.text)}</span>
      <span class="problem-card-progress">已填写 ${completed} 题 · ${issue.completion}%</span>
      <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
    </button>`;
  }).join('') : '<div class="queue-empty">暂无议题，点击右上方“新增议题”。</div>';
  $('#reviewProblemList').scrollTop = scrollTop;
  $all('[data-review-issue-id]').forEach(button => button.addEventListener('click', () => {
    state.activeIssueId = button.dataset.reviewIssueId;
    questionLibraryFilter = 'all';
    renderReview();
    save();
  }));
}

function filterQuestions(issue) {
  return issue.questions.map((question, index) => ({ question, index })).filter(item => questionLibraryFilter === 'all' || item.question.category === questionLibraryFilter);
}

function renderQuestionList(issue) {
  const filtered = filterQuestions(issue);
  const groups = [];
  filtered.forEach(item => {
    const code = item.question.category || 'X';
    let group = groups.find(entry => entry.code === code);
    if (!group) {
      const definition = QUESTION_CATEGORIES.find(category => category.code === code);
      group = {
        code,
        name: item.question.categoryName || definition?.name || '历史问题',
        rule: item.question.rule || definition?.rule || '—',
        confidence: item.question.confidence || definition?.confidence || '—',
        items: []
      };
      groups.push(group);
    }
    group.items.push(item);
  });

  $('#questionLibraryList').innerHTML = groups.map(group => {
    const completed = group.items.filter(item => item.question.answer || item.question.skipped).length;
    return `<section class="question-library-card">
      <header class="question-library-card-header">
        <span class="category-code">${escapeHtml(group.code)}</span>
        <span class="category-description"><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.rule)} · 置信度 ${escapeHtml(group.confidence)}</span></span>
        <span class="category-count">${completed}/${group.items.length}</span>
      </header>
      ${group.items.map(({ question, index }) => `<button class="library-question ${index === issue.questionIndex ? 'active' : ''} ${question.answer || question.skipped ? 'complete' : ''}" type="button" data-question-index="${index}"><span>${escapeHtml(question.q)}</span><span class="library-question-status">${question.gap ? '待确认' : question.answer || question.skipped ? '已填写' : '未填写'}</span></button>`).join('')}
    </section>`;
  }).join('') || '<div class="queue-empty">该分类暂无问题。</div>';

  $all('.library-question').forEach(button => button.addEventListener('click', () => {
    issue.questionIndex = Number(button.dataset.questionIndex);
    renderQuestionChain();
    save();
  }));
}

function renderQuestionStage(issue) {
  const question = issue.questions[issue.questionIndex];
  if (!question) {
    $('#questionStage').innerHTML = '<div class="queue-empty">该分类暂无问题。</div>';
    return;
  }
  const category = QUESTION_CATEGORIES.find(item => item.code === question.category);
  const categoryLabel = question.categoryName || category?.name || '历史问题';
  const rule = question.rule || category?.rule || '—';
  const confidence = question.confidence || category?.confidence || '—';
  $('#questionStage').innerHTML = `<div class="question-stage-meta">
      <span class="category-code">${escapeHtml(question.category || 'X')}</span>
      <span class="category-description"><strong>${escapeHtml(categoryLabel)}</strong><span>${escapeHtml(rule)} · 置信度 ${escapeHtml(confidence)}</span></span>
    </div>
    <article class="question-item" data-question-index="${issue.questionIndex}">
      <div class="question-copy">
        <h2>${escapeHtml(question.q)}</h2>
        <small>选择这个问题后，记录 Team Member 的事实、数字、判断或引用。</small>
        <span class="question-state">${question.gap ? '待确认' : question.answer ? '已填写' : '未填写'}</span>
      </div>
      <div class="question-answer-panel">
        <div class="question-answer-inner">
          <label for="activeQuestionAnswer">Team Member 回答 / 现场记录</label>
          <textarea class="question-answer" id="activeQuestionAnswer" maxlength="1000" placeholder="记录事实、数字或引用">${escapeHtml(question.answer)}</textarea>
          <div class="quick-actions">
            <button class="quick" type="button" data-quick="不清楚，需要会后确认。"><span class="material-symbols-rounded" aria-hidden="true">help</span>不清楚</button>
            <button class="quick" type="button" data-quick="已有口头结论，但没有书面记录。"><span class="material-symbols-rounded" aria-hidden="true">chat</span>仅口头</button>
            <button class="quick" type="button" data-quick="专业负责人尚未确认。"><span class="material-symbols-rounded" aria-hidden="true">verified_user</span>未专业确认</button>
            <button class="quick" type="button" data-quick="当前没有明确的完成时间。"><span class="material-symbols-rounded" aria-hidden="true">schedule</span>无时间</button>
          </div>
          <div class="question-actions">
            <button class="button primary save-question" type="button"><span class="material-symbols-rounded" aria-hidden="true">check</span>保存回答</button>
            <button class="button secondary gap-question" type="button"><span class="material-symbols-rounded" aria-hidden="true">add_box</span>保存并标记待确认</button>
            ${question.answer || question.skipped ? '<button class="button tertiary clear-question" type="button">清除</button>' : ''}
          </div>
          ${question.gap ? '<div class="gap-note">此回答需要后续确认。</div>' : ''}
        </div>
      </div>
    </article>
    <div class="saved-feedback" id="savedFeedback"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span>已保存<div class="save-particles">${Array.from({ length: 7 }, () => '<i class="save-particle"></i>').join('')}</div></div>`;

  $all('.quick').forEach(button => button.addEventListener('click', () => {
    $('#activeQuestionAnswer').value = button.dataset.quick;
    $('#activeQuestionAnswer').focus();
  }));
  $('.save-question').addEventListener('click', () => recordAnswer(false));
  $('.gap-question').addEventListener('click', () => recordAnswer(true));
  $('.clear-question')?.addEventListener('click', clearAnswer);
}

function renderQuestionChain() {
  const issue = state.issues.find(item => item.id === state.activeIssueId);
  if (!issue) return;
  const chain = $('#questionChain');
  const scrollTop = chain.dataset.issueId === issue.id ? ($('#questionLibraryList')?.scrollTop || 0) : 0;
  if (questionLibraryFilter !== 'all' && !issue.questions.some(question => question.category === questionLibraryFilter)) questionLibraryFilter = 'all';
  const categories = QUESTION_CATEGORIES.filter(category => issue.questions.some(question => question.category === category.code));
  chain.innerHTML = `<div class="question-category-filters" aria-label="问题分类">
      <button class="filter-chip ${questionLibraryFilter === 'all' ? 'active' : ''}" type="button" data-question-filter="all">全部</button>
      ${categories.map(category => `<button class="filter-chip ${questionLibraryFilter === category.code ? 'active' : ''}" type="button" data-question-filter="${category.code}" aria-label="${escapeHtml(category.name)}">${category.code}</button>`).join('')}
    </div>
    <div class="question-library-layout">
      <div class="question-library-list" id="questionLibraryList"></div>
      <div class="question-stage" id="questionStage"></div>
    </div>`;
  chain.dataset.issueId = issue.id;

  $all('[data-question-filter]').forEach(button => button.addEventListener('click', () => {
    questionLibraryFilter = button.dataset.questionFilter;
    const first = filterQuestions(issue)[0];
    if (first) issue.questionIndex = first.index;
    renderQuestionChain();
    save();
  }));
  renderQuestionList(issue);
  $('#questionLibraryList').scrollTop = scrollTop;
  requestAnimationFrame(() => renderQuestionStage(issue));
}

function renderReview() {
  ensureState();
  renderCategoryOptions();
  renderQueue();
  const issue = state.issues.find(item => item.id === state.activeIssueId);
  $('#reviewEmpty').classList.toggle('hidden', Boolean(issue));
  $('#activeReviewArea').classList.toggle('hidden', !issue);
  if (issue) renderQuestionChain();
}

function recordAnswer(gap) {
  const issue = state.issues.find(item => item.id === state.activeIssueId);
  const question = issue?.questions[issue.questionIndex];
  const answerField = $('#activeQuestionAnswer');
  if (!question || !answerField) return;
  const answer = answerField.value.trim();
  if (!answer && !gap) { answerField.focus(); return; }
  question.answer = answer || '不清楚，需要会后确认。';
  question.skipped = false;
  question.gap = gap || /不清楚|不知道|没有|未确认|待确认|口头/.test(question.answer);
  refreshIssue(issue);
  renderReview();
  requestAnimationFrame(animateSavedFeedback);
  save();
}

function clearAnswer() {
  const issue = state.issues.find(item => item.id === state.activeIssueId);
  const question = issue?.questions[issue.questionIndex];
  if (!question) return;
  question.answer = '';
  question.skipped = false;
  question.gap = false;
  refreshIssue(issue);
  renderReview();
  save();
}

function addIssue() {
  const text = $('#newIssueText').value.trim();
  const priority = $('#newIssuePriority').value;
  const categoryId = $('#newIssueCategory').value;
  if (!text) { $('#newIssueText').focus(); return; }
  if (!priority) { $('#newIssuePriority').focus(); return; }
  if (!categoryId) { $('#newIssueCategory').focus(); return; }
  const issue = buildIssue(text, priority, categoryId);
  state.issues.push(issue);
  state.activeIssueId = issue.id;
  questionLibraryFilter = 'all';
  $('#newIssueText').value = '';
  $('#newIssuePriority').value = '';
  toggleNewIssue(false);
  renderReview();
  save();
}

function toggleNewIssue(force) {
  const panel = $('#newIssuePanel');
  const button = $('#toggleNewIssue');
  const shouldOpen = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  button.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) requestAnimationFrame(() => $('#newIssueText').focus());
}

async function saveNow() {
  if (!serverReady) return false;
  if (saveInFlight) {
    savePending = true;
    await saveInFlight;
    return saveNow();
  }
  saveInFlight = serverCall('saveReview', state);
  try {
    await saveInFlight;
    hideBanner();
    return true;
  } catch (error) {
    showBanner(`保存失败：${error.message}`);
    return false;
  } finally {
    saveInFlight = null;
    if (savePending) {
      savePending = false;
      save();
    }
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 280);
}

async function loadReview(reviewId) {
  state = await serverCall('loadReview', reviewId);
  ensureState();
  localStorage.setItem(LAST_REVIEW_KEY, state.reviewId);
  renderReview();
}

function bindEvents() {
  SYSTEM_THEME_QUERY.addEventListener('change', applySystemTheme);
  $('#toggleNewIssue').addEventListener('click', () => toggleNewIssue());
  $('#addIssue').addEventListener('click', addIssue);
  window.addEventListener('beforeunload', () => { if (serverReady) saveNow(); });
}

async function boot() {
  applySystemTheme();
  bindEvents();
  renderReview();
  try {
    const bootstrap = await serverCall('getBootstrap');
    serverReady = true;
    const reviews = Array.isArray(bootstrap.reviews) ? bootstrap.reviews : [];
    const preferredId = localStorage.getItem(LAST_REVIEW_KEY);
    const selected = reviews.find(review => review.reviewId === preferredId) || reviews[0];
    if (selected) await loadReview(selected.reviewId);
    else {
      state.modelVersion = bootstrap.modelVersion || DEFAULT_MODEL_VERSION;
      renderReview();
    }
    hideBanner();
  } catch (error) {
    showBanner(`${error.message} 请先启动本地服务。`);
  }
}

boot();
