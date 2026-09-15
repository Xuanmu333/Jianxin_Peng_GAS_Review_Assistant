const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const today=()=>new Date().toISOString().slice(0,10);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const clone=value=>JSON.parse(JSON.stringify(value));
const keyFor=question=>`${String(question.questionId||question.id||'').replace(/@\d+$/,'')}@${Number(question.version||String(question.id||'').match(/@(\d+)$/)?.[1]||1)}`;
const AI_CONFIG_KEY='review-ai-config-v2';
const ANSWER_PANE_WIDTH_KEY='review-answer-pane-width';
const helpByCategory={A:'把状态词还原为明确对象和事实。',B:'确认原始基线，避免把变化和原计划混在一起。',C:'把日期落到关键路径和实际节点。',D:'确认样本、方法、标准和证据来源。',E:'补齐进度、成本、资源和用户影响。',F:'检查问题是否扩散到其他项目、版本或物料。',G:'让不同方案在同一基线上比较。',H:'明确发生概率、用户后果和可恢复性。',I:'区分供应商承诺、外部判断与内部确认。',J:'把完整成本与责任归属分开。',K:'区分可逆准备和不可逆决策。',L:'明确事实负责人、专业确认人和最终决策人。',M:'把动作、负责人、期限、验证和关闭条件连起来。',N:'识别长期未决的真实阻塞和升级路径。',O:'先保留支持决策的关键信息。',P:'让各方使用同一个可测量的成功标准。',AI:'根据本问题全部回答补齐尚未覆盖的追问。'};

let bootstrap={reviews:[],questions:[],storage:''};
let state=null;
let activeView='review';
let categoryFilter='all';
let reportCategoryFilter='all';
let reportStatusFilter='all';
let selectedQuestionKey='';
let savePromise=Promise.resolve();
let busy=false;

async function api(path,options={}){
  const response=await fetch(path,{headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})},...options});
  const raw=await response.text();let data={};
  try{data=raw?JSON.parse(raw):{}}catch{throw new Error(`服务返回了无法识别的数据（HTTP ${response.status}）`)}
  if(response.status===401){location.href='/login.html?state=signed_out';throw new Error('登录状态已过期')}
  if(response.status===403&&data.error?.includes('授权')){location.href='/login.html?state=pending';throw new Error(data.error)}
  if(!response.ok)throw new Error(data.error||`请求失败（HTTP ${response.status}）`);
  return data;
}
function flash(message,error=false){const el=$('#appMessage');el.textContent=message;el.className=`app-message${error?' error':''}`;clearTimeout(flash.timer);flash.timer=setTimeout(()=>el.classList.add('hidden'),2800)}
function setSync(label,type=''){const el=$('#syncState');el.className=`sync-state ${type}`;el.querySelector('span').textContent=label}
function animate(targets){if(!window.gsap||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const nodes=typeof targets==='string'?$$(targets):targets;if(!nodes?.length)return;gsap.fromTo(nodes,{autoAlpha:0,y:5},{autoAlpha:1,y:0,duration:.22,ease:'power2.out',stagger:.012,clearProps:'transform,opacity,visibility'})}

function blankReview(project){return{reviewId:uid('R'),projectId:uid('P'),project,date:today(),reviewStatus:'in_progress',modelVersion:'v0.2',issueCategories:[{id:'quality',name:'质量'},{id:'reliability',name:'可靠性'},{id:'schedule',name:'进度'},{id:'validation',name:'验证'}],issueHistory:[],hiddenIssueIds:[],issues:[],activeIssueId:null,createdAt:new Date().toISOString()}}
function localQuestionSeed(){const categories=typeof QUESTION_CATEGORIES!=='undefined'&&Array.isArray(QUESTION_CATEGORIES)?QUESTION_CATEGORIES:[];return categories.flatMap(category=>category.questions.map((q,index)=>({questionId:`${category.code}${index+1}`,version:1,id:`${category.code}${index+1}@1`,category:category.code,categoryName:category.name,rule:category.rule,confidence:category.confidence,q,status:'active',sourceLabel:'本地提问库'})))}
function libraryQuestions(){return bootstrap.questions.map(question=>({...question,id:keyFor(question),questionId:String(question.questionId||question.id).replace(/@\d+$/,''),version:Number(question.version||1),answer:'',answerStatus:'',skipped:false,gap:false,source:'library'}))}
function mergeQuestions(existing=[]){
  const savedByKey=new Map(existing.map(question=>[keyFor(question),question]));
  const active=libraryQuestions().map(question=>{const saved=savedByKey.get(question.id);return saved?{...question,q:saved.answer?saved.q||question.q:question.q,answer:saved.answer||'',answerStatus:saved.answerStatus||'',gap:Boolean(saved.gap),skipped:Boolean(saved.skipped)}:question});
  const activeKeys=new Set(active.map(question=>question.id));
  const retained=existing.filter(question=>(question.answer||question.source==='ai')&&!activeKeys.has(keyFor(question))).map(question=>({...question,id:keyFor(question)}));
  return [...active,...retained];
}
function normalizeReview(review){
  review.issueCategories=Array.isArray(review.issueCategories)?review.issueCategories:[];
  review.issueHistory=Array.isArray(review.issueHistory)?review.issueHistory:[];
  review.issues=Array.isArray(review.issues)?review.issues:[];
  const statusMap={open:'待确认',pending:'待确认','未开始':'待确认','review 进行中':'跟进中','in progress':'跟进中',in_progress:'跟进中',verified:'待验证',closed:'已关闭'};
  review.issues.forEach(issue=>{issue.id=issue.id||issue.issueId||uid('ISSUE');issue.title=issue.title||issue.text||'未命名问题';issue.text=issue.text||issue.title;issue.status=statusMap[String(issue.status||'').toLowerCase()]||issue.status||'待确认';issue.questions=mergeQuestions(issue.questions||[]);issue.questionIndex=Number.isInteger(issue.questionIndex)?issue.questionIndex:0});
  if(!review.activeIssueId&&review.issues.length)review.activeIssueId=review.issues[0].id;
  return review;
}
function activeIssue(){return state?.issues.find(issue=>issue.id===state.activeIssueId)||null}
function selectedQuestion(){const issue=activeIssue();return issue?.questions.find(question=>keyFor(question)===selectedQuestionKey)||null}
function categoryName(issue){return state?.issueCategories.find(category=>category.id===issue.categoryId)?.name||issue.categoryName||'未分类'}
function answeredCount(issue){return(issue.questions||[]).filter(question=>question.answer&&!question.skipped).length}
function statusClass(status){if(status==='已关闭')return'green';if(status==='跟进中')return'blue';return'amber'}

async function saveState(message='已保存到 Google Sheets'){
  if(!state)return false;
  setSync('正在保存');
  const payload=clone(state);
  savePromise=savePromise.catch(()=>undefined).then(()=>api(`/api/reviews/${encodeURIComponent(payload.reviewId)}`,{method:'PUT',body:JSON.stringify(payload)}));
  try{const result=await savePromise;setSync('已同步','good');upsertBootstrap(result.updatedAt);if(message)flash(message);return true}catch(error){setSync('保存失败','error');flash(error.message,true);return false}
}
function upsertBootstrap(updatedAt=new Date().toISOString()){
  const summary={reviewId:state.reviewId,projectId:state.projectId,projectName:state.project,reviewDate:state.date,status:state.reviewStatus,updatedAt};
  bootstrap.reviews=[summary,...bootstrap.reviews.filter(item=>item.reviewId!==state.reviewId)];
  renderProjects();
}
async function loadReview(reviewId){
  if(!reviewId)return;
  setSync('正在读取');
  try{state=normalizeReview(await api(`/api/reviews/${encodeURIComponent(reviewId)}`));categoryFilter='all';selectedQuestionKey=keyFor(activeIssue()?.questions?.[activeIssue()?.questionIndex||0]||{});renderAll();setSync('已同步','good')}catch(error){setSync('读取失败','error');flash(error.message,true)}
}

function renderAll(){renderProjects();renderIssues();renderQuestionWorkspace();renderReports()}
function renderProjects(){
  const select=$('#projectSelect');if(!select)return;
  select.innerHTML=bootstrap.reviews.map(item=>`<option value="${esc(item.reviewId)}" ${state?.reviewId===item.reviewId?'selected':''}>${esc(item.projectName||'未命名项目')}</option>`).join('');
  if(!bootstrap.reviews.length)select.innerHTML='<option value="">尚未创建项目</option>';
  const query=($('#projectSearch')?.value||'').trim().toLowerCase();
  $('#projectList').innerHTML=bootstrap.reviews.filter(item=>!query||item.projectName.toLowerCase().includes(query)).map(item=>`<button class="project-row ${state?.reviewId===item.reviewId?'active':''}" data-project-id="${esc(item.reviewId)}"><span>${esc(item.projectName)}</span><small>${state?.reviewId===item.reviewId?state.issues.length:''}</small></button>`).join('')||'<div class="empty-list">没有项目</div>';
  $$('[data-project-id]').forEach(button=>button.onclick=()=>loadReview(button.dataset.projectId));
}
function renderIssues(){
  const issues=state?.issues||[];
  $('#issueList').innerHTML=issues.map(issue=>`<button class="issue-row ${issue.id===state.activeIssueId?'active':''}" data-issue-id="${esc(issue.id)}"><strong>${esc(issue.title)}</strong><small>${esc(categoryName(issue))} · 已记录 ${answeredCount(issue)} 题</small></button>`).join('')||'<div class="empty-list">新增一个项目问题后开始 Review</div>';
  $$('[data-issue-id]').forEach(button=>button.onclick=()=>{state.activeIssueId=button.dataset.issueId;const issue=activeIssue();selectedQuestionKey=keyFor(issue?.questions?.[issue.questionIndex||0]||{});categoryFilter='all';renderIssues();renderQuestionWorkspace();animate('.question-row')});
}
function visibleCategories(){
  const all=bootstrap.questions.reduce((map,question)=>map.set(question.category,{code:question.category,name:question.categoryName}),new Map());
  if(activeIssue()?.questions.some(question=>question.category==='AI'))all.set('AI',{code:'AI',name:'AI 补充追问'});
  return [...all.values()];
}
function renderQuestionWorkspace(){
  const issue=activeIssue();
  $('#reviewBreadcrumb').textContent=issue?`${state.project} / ${issue.title}`:'请选择一个项目问题';
  $('#generateAiQuestions').disabled=!issue||!issue.questions.some(question=>question.answer);
  const categories=visibleCategories();
  $('#questionCategories').innerHTML=`<button class="category-tab ${categoryFilter==='all'?'active':''}" data-question-category="all">全部 ${categories.length} 类</button>${categories.map(category=>`<button class="category-tab ${categoryFilter===category.code?'active':''}" data-question-category="${esc(category.code)}">${esc(category.name)}</button>`).join('')}`;
  $$('[data-question-category]').forEach(button=>button.onclick=()=>{categoryFilter=button.dataset.questionCategory;renderQuestionWorkspace()});
  if(!issue){$('#questionLibraryHead').innerHTML='';$('#questionList').innerHTML='<div class="empty-list">先在左侧选择或新增一个项目问题。</div>';renderAnswer();return}
  const search=$('#questionSearch').value.trim().toLowerCase();
  const questions=issue.questions.filter(question=>(categoryFilter==='all'||question.category===categoryFilter)&&(!search||`${question.q} ${question.categoryName||''} ${question.rule||''}`.toLowerCase().includes(search)));
  const selectedCategory=categoryFilter==='all'?null:categories.find(category=>category.code===categoryFilter);
  $('#questionLibraryHead').innerHTML=`<div><h2>${selectedCategory?`${esc(selectedCategory.code)} · ${esc(selectedCategory.name)}`:'全部提问'}</h2><p>问法来自会议提炼，不代表老板逐字原话。</p></div><small>提问库 v0.2 · ${questions.length} 条</small>`;
  $('#questionList').innerHTML=questions.map(question=>`<button class="question-row ${keyFor(question)===selectedQuestionKey?'active':''} ${question.answer?'answered':''}" data-question-key="${esc(keyFor(question))}"><span class="q-icon material-symbols-rounded">${question.answer?'check_circle':'description'}</span><strong>${esc(question.q)}</strong><em>${question.answer?'有记录':keyFor(question)===selectedQuestionKey?'正在记录':''}</em><span class="material-symbols-rounded">chevron_right</span></button>`).join('')||'<div class="empty-list">没有匹配的提问。</div>';
  $$('[data-question-key]').forEach(button=>button.onclick=()=>{selectedQuestionKey=button.dataset.questionKey;issue.questionIndex=issue.questions.findIndex(question=>keyFor(question)===selectedQuestionKey);renderQuestionWorkspace();animate('.answer-content')});
  renderAnswer();
}
function renderAnswer(){
  const question=selectedQuestion();
  $('#answerEmpty').classList.toggle('hidden',Boolean(question));$('#answerContent').classList.toggle('hidden',!question);
  if(!question)return;
  $('#selectedQuestionText').textContent=question.q;$('#questionHelpText').textContent=helpByCategory[question.category]||'帮助把模糊表达变成可以验证的事实。';$('#answerText').value=question.answer||'';$('#answerCount').textContent=`${(question.answer||'').length} / 3000`;
}

function reportTextToHtml(text){
  if(!text)return'';
  const blocks=[];let list=[];
  const flush=()=>{if(list.length){blocks.push(`<ul>${list.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`);list=[]}};
  for(const raw of text.split('\n')){const line=raw.trim();if(!line)continue;const heading=line.match(/^#{1,3}\s+(.+)/);const bullet=line.match(/^[-*]\s+(.+)/);if(heading){flush();blocks.push(`<h2>${esc(heading[1])}</h2>`)}else if(bullet)list.push(bullet[1]);else{flush();blocks.push(`<p>${esc(line)}</p>`)}}
  flush();return blocks.join('');
}
function renderReports(){
  if(!state)return;
  $('#reportProjectTitle').textContent=state.project;$('#reportProjectCount').textContent=`${state.issues.length} 个问题`;
  const categories=state.issueCategories||[];$('#issueCategoryFilter').innerHTML='<option value="all">全部分类</option>'+categories.map(category=>`<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('');$('#issueCategoryFilter').value=reportCategoryFilter;$('#issueStatusFilter').value=reportStatusFilter;
  const search=($('#issueSearch').value||'').trim().toLowerCase(),category=reportCategoryFilter,status=reportStatusFilter;
  const issues=state.issues.filter(issue=>(!search||`${issue.title} ${issue.text}`.toLowerCase().includes(search))&&(category==='all'||issue.categoryId===category)&&(status==='all'||issue.status===status));
  $('#reportIssueList').innerHTML=issues.map(issue=>`<button class="report-issue-row ${issue.id===state.activeIssueId?'active':''}" data-report-issue-id="${esc(issue.id)}"><span><strong>${esc(issue.title)}</strong><small>${issue.report?`报告 V${issue.report.version||1}`:'尚未生成报告'} · 已记录 ${answeredCount(issue)} 题</small></span><span class="pill">${esc(categoryName(issue))}</span><span class="pill ${statusClass(issue.status)}">${esc(issue.status)}</span></button>`).join('')||'<div class="empty-list">没有匹配的问题</div>';
  $$('[data-report-issue-id]').forEach(button=>button.onclick=()=>{state.activeIssueId=button.dataset.reportIssueId;renderIssues();renderQuestionWorkspace();renderReports()});
  renderReportPane();
}
function renderReportPane(){
  const issue=activeIssue();if(!issue){$('#reportPane').innerHTML='<div class="report-empty">请选择一个项目问题</div>';return}
  const report=issue.report;
  $('#reportPane').innerHTML=`<div class="report-top"><div><p class="breadcrumb">${esc(state.project)} / ${esc(categoryName(issue))} / ${esc(issue.id)}</p><div class="report-title-row"><h1>${esc(issue.title)}</h1><span class="pill ${statusClass(issue.status)}">${esc(issue.status)}</span></div><p class="report-meta">问题报告${report?` · V${report.version||1} · ${esc((report.updatedAt||'').replace('T',' ').slice(0,16))}`:' · 尚未生成'}</p></div></div>${report?`<div class="report-document report-raw">${reportTextToHtml(report.text)}</div>`:`<div class="report-placeholder"><span class="material-symbols-rounded">description</span><h2>尚未生成问题报告</h2><p>报告只根据当前问题已保存的 Review 回答整理。</p></div>`}<div class="report-actions"><button class="button primary" id="generateReport"><span class="material-symbols-rounded">auto_awesome</span>${report?'更新报告':'生成问题报告'}</button><button class="button outline" id="continueReview">继续 Review</button></div>`;
  $('#continueReview').onclick=()=>switchView('review');$('#generateReport').onclick=generateReport;
}

function snapshot(issue,note){const copy=clone(issue);copy.issueId=issue.id;copy.snapshotId=uid('V');copy.version=(state.issueHistory.filter(item=>(item.issueId||item.id)===issue.id).at(-1)?.version||0)+1;copy.capturedAt=new Date().toISOString();copy.updateNote=note;copy.categoryName=categoryName(issue);return copy}
async function saveAnswer(){const issue=activeIssue(),question=selectedQuestion();if(!issue||!question)return;const answer=$('#answerText').value.trim();if(!answer){$('#answerText').focus();return}question.answer=answer;question.answerStatus=question.answerStatus||'recorded';question.answerUpdatedAt=new Date().toISOString();question.gap=false;question.skipped=false;state.issueHistory.push(snapshot(issue,`回答：${question.q}`));await saveState('回答已保存');renderAll();animate('.question-row.active')}
async function generateAiQuestions(){
  const issue=activeIssue();if(!issue||busy)return;const answered=issue.questions.filter(question=>question.answer);if(!answered.length){flash('请先保存至少一条预设问题的回答。',true);return}
  const config=getAiConfig();if(!config.endpoint||!config.model||!config.apiKey){openModal('aiSettingsModal');return}
  busy=true;$('#generateAiQuestions').disabled=true;$('#generateAiQuestions').innerHTML='<span class="material-symbols-rounded">progress_activity</span>正在综合分析';
  try{const result=await api('/api/ai/questions',{method:'POST',body:JSON.stringify({context:{project:state.project,topic:issue.text,questions:issue.questions.map(question=>({question:question.q,answer:question.answer||'',skipped:Boolean(question.skipped)}))},config})});const existing=new Set(issue.questions.map(question=>question.q.replace(/\s+/g,'').toLowerCase()));const additions=(result.questions||[]).filter(text=>!existing.has(String(text).replace(/\s+/g,'').toLowerCase())).slice(0,5);const batchId=Date.now();additions.forEach((q,index)=>{const questionId=`AI-${batchId}-${index+1}`;issue.questions.push({id:`${questionId}@1`,questionId,version:1,category:'AI',categoryName:'AI 补充追问',rule:'AI',confidence:'基于全部回答',q,answer:'',answerStatus:'',skipped:false,gap:false,source:'ai'})});if(!additions.length)throw new Error('没有发现与现有提问不同的新问题。');categoryFilter='AI';selectedQuestionKey=keyFor(issue.questions.at(-additions.length));state.issueHistory.push(snapshot(issue,'AI 深入追问'));await saveState(`已补充 ${additions.length} 条不重复的追问`);renderAll()}catch(error){flash(error.message,true)}finally{busy=false;$('#generateAiQuestions').innerHTML='<span class="material-symbols-rounded">auto_awesome</span>AI 深入追问';renderQuestionWorkspace()}
}
async function generateReport(){
  const issue=activeIssue();if(!issue||busy)return;const answered=issue.questions.filter(question=>question.answer);if(!answered.length){flash('至少保存一条回答后才能生成报告。',true);return}
  const config=getAiConfig();if(!config.endpoint||!config.model||!config.apiKey){openModal('aiSettingsModal');return}
  busy=true;$('#generateReport').disabled=true;$('#generateReport').textContent='正在生成…';
  try{const result=await api('/api/ai/report',{method:'POST',body:JSON.stringify({context:{project:state.project,topic:issue.text,category:categoryName(issue),questions:answered.map(question=>({question:question.q,answer:question.answer}))},config})});if(!result.report)throw new Error('AI 没有返回报告内容。');issue.report={version:(issue.report?.version||0)+1,text:result.report,updatedAt:new Date().toISOString()};state.issueHistory.push(snapshot(issue,'更新问题报告'));await saveState('问题报告已保存');renderReports()}catch(error){flash(error.message,true)}finally{busy=false;renderReportPane()}
}

function getAiConfig(){let stored={};try{stored=JSON.parse(localStorage.getItem(AI_CONFIG_KEY)||'{}')}catch{}return{endpoint:stored.endpoint||'',model:stored.model||'',apiKey:sessionStorage.getItem(`${AI_CONFIG_KEY}-key`)||''}}
function openModal(id){$(`#${id}`).classList.remove('hidden');requestAnimationFrame(()=>animate([ $(`#${id} .modal`) ]))}
function closeModals(){$$('.modal-backdrop').forEach(modal=>modal.classList.add('hidden'))}
function switchView(view){activeView=view;$('#reviewView').classList.toggle('hidden',view!=='review');$('#reportsView').classList.toggle('hidden',view!=='reports');$$('.top-nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));if(view==='reports')renderReports();animate(view==='review'?'.question-pane,.answer-pane':'.report-list-pane,.report-pane')}
function fillIssueCategories(){const select=$('#issueCategory');select.innerHTML=(state?.issueCategories||[]).map(category=>`<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('')||'<option value="general">综合问题</option>'}

function initAnswerPaneResize(){
  const shell=$('#reviewView'),handle=$('#answerPaneResizer');
  if(!shell||!handle)return;
  const limits=()=>({min:340,max:Math.max(340,Math.min(720,shell.clientWidth-260-480-9))});
  const apply=value=>{const {min,max}=limits();const width=Math.round(Math.min(max,Math.max(min,Number(value)||460)));shell.style.setProperty('--answer-pane-width',`${width}px`);handle.setAttribute('aria-valuenow',String(width));return width};
  let width=apply(localStorage.getItem(ANSWER_PANE_WIDTH_KEY)||460),startX=0,startWidth=width,dragging=false;
  handle.addEventListener('pointerdown',event=>{if(matchMedia('(max-width: 850px)').matches)return;dragging=true;startX=event.clientX;startWidth=width;handle.setPointerCapture(event.pointerId);shell.classList.add('is-resizing')});
  handle.addEventListener('pointermove',event=>{if(!dragging)return;width=apply(startWidth+startX-event.clientX)});
  const finish=event=>{if(!dragging)return;dragging=false;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);shell.classList.remove('is-resizing');localStorage.setItem(ANSWER_PANE_WIDTH_KEY,String(width))};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  handle.addEventListener('dblclick',()=>{width=apply(460);localStorage.setItem(ANSWER_PANE_WIDTH_KEY,String(width))});
  handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();width=apply(event.key==='Home'?460:width+(event.key==='ArrowLeft'?24:-24));localStorage.setItem(ANSWER_PANE_WIDTH_KEY,String(width))});
  window.addEventListener('resize',()=>{width=apply(width)});
}

function bindEvents(){
  $$('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
  $('#projectSelect').onchange=event=>loadReview(event.target.value);$('#questionSearch').oninput=renderQuestionWorkspace;$('#projectSearch').oninput=renderProjects;$('#issueSearch').oninput=renderReports;
  $('#issueCategoryFilter').onchange=event=>{reportCategoryFilter=event.target.value;renderReports()};$('#issueStatusFilter').onchange=event=>{reportStatusFilter=event.target.value;renderReports()};
  $('#answerText').oninput=event=>$('#answerCount').textContent=`${event.target.value.length} / 3000`;$('#saveAnswer').onclick=saveAnswer;$('#generateAiQuestions').onclick=generateAiQuestions;
  $('#openProjectModal').onclick=$('#openProjectModalFromReports').onclick=()=>openModal('projectModal');$('#openIssueModal').onclick=$('#openIssueModalFromReports').onclick=()=>{if(!state){flash('请先新增项目。',true);return}fillIssueCategories();openModal('issueModal')};$('#openAiSettings').onclick=()=>{const config=getAiConfig();$('#aiEndpoint').value=config.endpoint;$('#aiModel').value=config.model;$('#aiApiKey').value=config.apiKey;openModal('aiSettingsModal')};
  $$('.close-modal').forEach(button=>button.onclick=closeModals);$$('.modal-backdrop').forEach(modal=>modal.onclick=event=>{if(event.target===modal)closeModals()});
  $('#projectForm').onsubmit=async event=>{event.preventDefault();const name=$('#projectName').value.trim();if(!name)return;state=blankReview(name);normalizeReview(state);await saveState('项目已创建');$('#projectName').value='';closeModals();renderAll()};
  $('#issueForm').onsubmit=async event=>{event.preventDefault();const title=$('#issueTitle').value.trim();if(!title)return;const issue={id:uid('ISSUE'),title,text:$('#issueDescription').value.trim()||title,categoryId:$('#issueCategory').value||'general',priority:$('#issuePriority').value,status:'待确认',questions:libraryQuestions(),questionIndex:0};state.issues.push(issue);state.activeIssueId=issue.id;selectedQuestionKey=keyFor(issue.questions[0]||{});await saveState('项目问题已添加');event.target.reset();closeModals();renderAll()};
  $('#addCategoryInline').onclick=()=>{const name=prompt('输入新的问题分类名称：');if(!name?.trim())return;const category={id:uid('CAT'),name:name.trim()};state.issueCategories.push(category);fillIssueCategories();$('#issueCategory').value=category.id};
  $('#aiSettingsForm').onsubmit=event=>{event.preventDefault();const endpoint=$('#aiEndpoint').value.trim(),model=$('#aiModel').value.trim(),apiKey=$('#aiApiKey').value.trim();if(!/^https:\/\//i.test(endpoint)||!model||!apiKey){flash('请填写 HTTPS Endpoint、模型和 API Key。',true);return}localStorage.setItem(AI_CONFIG_KEY,JSON.stringify({endpoint,model}));sessionStorage.setItem(`${AI_CONFIG_KEY}-key`,apiKey);closeModals();flash('AI 设置已保存')};
  $('#clearAiSettings').onclick=()=>{localStorage.removeItem(AI_CONFIG_KEY);sessionStorage.removeItem(`${AI_CONFIG_KEY}-key`);$('#aiSettingsForm').reset()};
  $('#toggleTheme').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('review-theme',next);$('#toggleTheme .material-symbols-rounded').textContent=next==='dark'?'light_mode':'dark_mode';$('#toggleTheme').setAttribute('aria-label',next==='dark'?'切换到浅色模式':'切换到深色模式')};
  $('#signOut').onclick=async()=>{await fetch('/api/auth/signout',{method:'POST'});location.href='/login.html'};
}

async function boot(){
  bindEvents();
  initAnswerPaneResize();
  const savedTheme=localStorage.getItem('review-theme')||'light';document.documentElement.dataset.theme=savedTheme;$('#toggleTheme .material-symbols-rounded').textContent=savedTheme==='dark'?'light_mode':'dark_mode';
  try{const session=await api('/api/auth/session');$('#accountEmail').textContent=session.email||'';$('#userAvatar').textContent=(session.name||session.email||'U').trim().slice(0,1).toUpperCase();$('#adminEntry').classList.toggle('hidden',!session.access?.isAdmin);bootstrap=await api('/api/bootstrap');if(!Array.isArray(bootstrap.questions)||!bootstrap.questions.length)bootstrap.questions=localQuestionSeed();if(!bootstrap.questions.length)throw new Error('Questions 工作表没有可用提问。');setSync(bootstrap.storage==='google-sheets'?'Google Sheets 已连接':'本地存储','good');if(bootstrap.reviews.length)await loadReview(bootstrap.reviews[0].reviewId);else renderAll();requestAnimationFrame(()=>animate('.app-header,.context-sidebar,.question-pane,.answer-pane'))}catch(error){setSync('连接失败','error');flash(error.message,true);renderAll()}
}
boot();
