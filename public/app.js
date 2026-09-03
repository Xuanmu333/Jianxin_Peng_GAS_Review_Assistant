const $=selector=>document.querySelector(selector);
const $all=selector=>[...document.querySelectorAll(selector)];
const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const today=()=>new Date().toISOString().slice(0,10);
const clean=value=>(value||'').replace(/^[-*•\d.、\s]+/,'').replace(/\s+/g,' ').trim();
const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const dateStamp=value=>`${/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:today()}T12:00:00.000Z`;

function freshState(){return{reviewId:uid('R'),projectId:uid('P'),project:'',date:today(),reviewStatus:'in_progress',modelVersion:DEFAULT_MODEL_VERSION,issueCategories:[],issueHistory:[],hiddenIssueIds:[],issues:[],activeIssueId:null,createdAt:new Date().toISOString()}}
let state=freshState();
let serverReady=false,saveTimer=null,saveInFlight=null,savePending=false,finishBusy=false,progressTimer=null,progressHideTimer=null,progressValue=0,aiBusy=false;
let projectReviewOptions=[],questionLibraryFilter='all',questionLibrarySearch='';
const AI_CONFIG_KEY='jp-local-ai-config';
const NAV_COLLAPSED_KEY='jp-local-nav-collapsed';
const motionEngine=window.gsap||null;
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateIn(target){if(motionEngine&&!reduceMotion&&target)motionEngine.fromTo(target,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.18,ease:'power2.out',clearProps:'transform,opacity,visibility'})}
function animateWorkspaceIntro(){
  if(!motionEngine||reduceMotion)return;
  const timeline=motionEngine.timeline({defaults:{duration:.5,ease:'power3.out'}});
  timeline.from('.app-header',{autoAlpha:0,y:-10,duration:.35})
    .from('.side-nav-menu .nav-item',{autoAlpha:0,x:-12,stagger:.055},'<.08')
    .from('.question-workspace-pane',{autoAlpha:0,y:12},'<.08')
    .from('.issue-capture-pane',{autoAlpha:0,x:14},'<.04');
}
function animateQuestionStage(){
  if(!motionEngine||reduceMotion)return;
  const stage=$('.question-stage'),cards=$all('.question-library-card');
  if(stage)motionEngine.fromTo(stage,{autoAlpha:0,x:12},{autoAlpha:1,x:0,duration:.32,ease:'power3.out',clearProps:'transform,opacity,visibility'});
  if(cards.length)motionEngine.fromTo(cards.slice(0,12),{autoAlpha:0,y:5},{autoAlpha:1,y:0,duration:.2,stagger:.016,ease:'power2.out',clearProps:'transform,opacity,visibility'});
}
function animateSavedFeedback(){
  const feedback=$('#savedFeedback'),particles=$all('.save-particle');
  if(!feedback)return;
  if(!motionEngine||reduceMotion){feedback.style.opacity='1';setTimeout(()=>feedback.style.opacity='0',800);return}
  motionEngine.timeline({defaults:{ease:'power3.out'}})
    .fromTo(feedback,{autoAlpha:0,x:-8},{autoAlpha:1,x:0,duration:.22})
    .fromTo(particles,{autoAlpha:0,x:0,y:0,scale:.4},{autoAlpha:1,x:()=>motionEngine.utils.random(-30,34),y:()=>motionEngine.utils.random(-28,16),scale:()=>motionEngine.utils.random(.7,1.5),duration:.32,stagger:.018},'<')
    .to(particles,{autoAlpha:0,duration:.22,stagger:.012},'>-.05')
    .to(feedback,{autoAlpha:0,x:8,duration:.28},'<.06');
}
function initKineticGrid(){
  const canvas=$('#kineticGridCanvas'),host=$('.question-workspace-pane');
  if(!canvas||!host||reduceMotion)return;
  const context=canvas.getContext('2d'),pointer={x:0,y:0},finePointer=window.matchMedia('(pointer: fine)').matches;
  let width=0,height=0,frame=0,active=false,settleFrames=0;
  const xTo=motionEngine?.quickTo(pointer,'x',{duration:.42,ease:'power3.out'}),yTo=motionEngine?.quickTo(pointer,'y',{duration:.42,ease:'power3.out'});
  const warp=(x,y)=>{
    const dx=pointer.x-x,dy=pointer.y-y,distance=Math.hypot(dx,dy),radius=Math.max(230,Math.min(width,height)*.42);
    const pull=Math.exp(-(distance*distance)/(radius*radius))*.27;
    return{x:x+dx*pull,y:y+dy*pull,distance};
  };
  const draw=()=>{
    context.clearRect(0,0,width,height);
    if(!width||!height)return;
    const columns=23,rows=17,left=-width*.08,right=width*1.08,top=-height*.08,bottom=height*1.08;
    context.lineWidth=.85;
    for(let row=0;row<rows;row+=1){
      context.beginPath();
      for(let column=0;column<columns;column+=1){
        const point=warp(left+(right-left)*(column/(columns-1)),top+(bottom-top)*(row/(rows-1)));
        if(column===0)context.moveTo(point.x,point.y);else context.lineTo(point.x,point.y);
      }
      context.strokeStyle='rgba(72,108,153,.16)';context.stroke();
    }
    for(let column=0;column<columns;column+=1){
      context.beginPath();
      for(let row=0;row<rows;row+=1){
        const point=warp(left+(right-left)*(column/(columns-1)),top+(bottom-top)*(row/(rows-1)));
        if(row===0)context.moveTo(point.x,point.y);else context.lineTo(point.x,point.y);
      }
      context.strokeStyle='rgba(72,108,153,.13)';context.stroke();
    }
    for(let row=0;row<rows;row+=1){
      for(let column=0;column<columns;column+=1){
        const point=warp(left+(right-left)*(column/(columns-1)),top+(bottom-top)*(row/(rows-1))),near=Math.max(0,1-point.distance/260);
        context.beginPath();context.arc(point.x,point.y,near?1.35:.9,0,Math.PI*2);context.fillStyle=`rgba(64,112,171,${.18+near*.3})`;context.fill();
      }
    }
    context.save();context.shadowColor='rgba(0,113,227,.32)';context.shadowBlur=16;context.beginPath();context.arc(pointer.x,pointer.y,2.3,0,Math.PI*2);context.fillStyle='rgba(0,113,227,.58)';context.fill();context.restore();
  };
  const loop=()=>{draw();if(active||settleFrames>0){settleFrames=Math.max(0,settleFrames-1);frame=requestAnimationFrame(loop)}else frame=0};
  const wake=()=>{if(!frame)frame=requestAnimationFrame(loop)};
  const resize=()=>{
    const rect=host.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
    width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);
    if(!pointer.x&&!pointer.y){pointer.x=width*.73;pointer.y=height*.43}draw();
  };
  if(finePointer){
    host.addEventListener('pointermove',event=>{const rect=host.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;active=true;if(xTo){xTo(x);yTo(y)}else{pointer.x=x;pointer.y=y}wake()});
    host.addEventListener('pointerleave',()=>{active=false;settleFrames=64;if(xTo){xTo(width*.73);yTo(height*.43)}else{pointer.x=width*.73;pointer.y=height*.43}wake()});
  }
  new ResizeObserver(resize).observe(host);resize();
}
async function serverCall(method,...args){
  let url='',options={headers:{Accept:'application/json'}};
  if(method==='getBootstrap')url='/api/bootstrap';
  else if(method==='loadReview')url=`/api/reviews/${encodeURIComponent(args[0])}`;
  else if(method==='saveReview'){const payload=args[0]||{};url=`/api/reviews/${encodeURIComponent(payload.reviewId||'')}`;options={method:'PUT',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)}}
  else if(method==='generateAiQuestions'){url='/api/ai/questions';options={method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({context:args[0],config:args[1]})}}
  else throw new Error(`未知的本地服务方法：${method}`);
  const response=await fetch(url,options),text=await response.text();let result={};
  try{result=text?JSON.parse(text):{}}catch{throw new Error(`本地服务返回了无法解析的数据（HTTP ${response.status}）。`)}
  if(!response.ok)throw new Error(result.error||`本地服务请求失败（HTTP ${response.status}）。`);return result
}
function showBanner(message,good=false){const el=$('#serverBanner');el.textContent=message;el.classList.remove('hidden','good');if(good)el.classList.add('good')}
function hideBanner(){$('#serverBanner').classList.add('hidden')}
function setOperationProgress(value,text){progressValue=Math.max(0,Math.min(100,value));$('#operationProgressBar').style.width=`${progressValue}%`;$('#operationProgressPct').textContent=`${Math.round(progressValue)}%`;if(text)$('#operationProgressText').textContent=text}
function startOperationProgress(text){clearInterval(progressTimer);clearTimeout(progressHideTimer);$('#operationProgress').classList.remove('hidden','error');setOperationProgress(8,text);progressTimer=setInterval(()=>setOperationProgress(Math.min(90,progressValue+Math.max(1,(92-progressValue)*.12))),500)}
function finishOperationProgress(success,text){clearInterval(progressTimer);$('#operationProgress').classList.toggle('error',!success);setOperationProgress(success?100:progressValue,text);if(success)progressHideTimer=setTimeout(()=>$('#operationProgress').classList.add('hidden'),700)}

async function boot(){
  bindEvents();applyNavigationPreference();applyStateToInputs();renderAll();initKineticGrid();requestAnimationFrame(animateWorkspaceIntro);
  try{const bootstrap=await serverCall('getBootstrap');serverReady=true;state.modelVersion=bootstrap.modelVersion||DEFAULT_MODEL_VERSION;projectReviewOptions=Array.isArray(bootstrap.reviews)?bootstrap.reviews:[];renderProjectFilters();$('#modelBadge').textContent=`已连接 · ${state.modelVersion}`;hideBanner()}
  catch(error){$('#modelBadge').textContent=`未连接 · ${DEFAULT_MODEL_VERSION}`;showBanner(`${error.message} 请使用 start.command（macOS）或 start.bat（Windows）启动应用。`)}
}

function classify(text){return TYPES.find(type=>type.regex.test(text))||TYPES[TYPES.length-1]}
function normalizeSeverity(value){return({P0:'S1',P1:'S2',P2:'S3',S1:'S1',S2:'S2',S3:'S3'})[value]||'S3'}
function titleFor(text,type,index){return text.replace(/[，。；;].*/,'').slice(0,24)||`${TYPES.find(item=>item.id===type)?.name||'综合议题'} ${index+1}`}
function buildQuestions(){return QUESTION_CATEGORIES.flatMap(category=>category.questions.map((q,index)=>({id:`${category.code}${index+1}`,category:category.code,categoryName:category.name,rule:category.rule,confidence:category.confidence,q,answer:'',skipped:false,gap:false,source:'library'})))}
function mergeQuestionLibrary(existing=[]){
  const byText=new Map(existing.map(question=>[clean(question.q),question])),library=buildQuestions(),libraryText=new Set(library.map(question=>clean(question.q)));
  const merged=library.map(question=>{const saved=byText.get(clean(question.q));return saved?{...question,answer:saved.answer||'',skipped:Boolean(saved.skipped),gap:Boolean(saved.gap)}:question});
  existing.filter(question=>!libraryText.has(clean(question.q))&&(question.answer||question.skipped||question.source==='ai')).forEach((question,index)=>merged.push({...question,id:question.id||`X${index+1}`,category:question.source==='ai'?'AI':'历史',categoryName:question.source==='ai'?'AI 扩展问题':'历史已填写问题',rule:question.rule||'—',confidence:question.confidence||'—'}));
  return merged
}
function buildIssue(text,priority,categoryId){const normalized=clean(text),type=classify(normalized).id;return{id:uid('I'),title:titleFor(normalized,type,state.issues.length),text:normalized,type,priority:normalizeSeverity(priority),categoryId,manualStatus:'',missing:DIMENSIONS.filter(item=>!item.regex.test(normalized)).map(item=>item.id),questions:buildQuestions(),questionIndex:0,questionLibraryVersion:QUESTION_LIBRARY_VERSION,forcedClosed:false,status:'未开始',completion:0,createdAt:new Date().toISOString()}}
function issueStatus(issue){
  if(issue.forcedClosed)return{label:'已关闭',pct:100};
  const answered=issue.questions.filter(question=>question.answer&&!question.skipped).length;
  return{label:answered?'Review 进行中':'未开始',pct:Math.min(95,answered*10)}
}
function refreshIssue(issue){const result=issueStatus(issue);issue.status=result.label;issue.completion=result.pct;return result}
function ensureState(){if(!Array.isArray(state.issueCategories))state.issueCategories=[];if(!Array.isArray(state.issueHistory))state.issueHistory=[];if(!Array.isArray(state.hiddenIssueIds))state.hiddenIssueIds=[];if(!Array.isArray(state.issues))state.issues=[];state.issues.forEach(issue=>{issue.categoryId=typeof issue.categoryId==='string'?issue.categoryId:'';issue.manualStatus=typeof issue.manualStatus==='string'?issue.manualStatus:'';issue.priority=normalizeSeverity(issue.priority);if(issue.questionLibraryVersion!==QUESTION_LIBRARY_VERSION){const selected=issue.questions?.[issue.questionIndex]?.q;issue.questions=mergeQuestionLibrary(Array.isArray(issue.questions)?issue.questions:[]);issue.questionIndex=Math.max(0,issue.questions.findIndex(question=>question.q===selected));issue.questionLibraryVersion=QUESTION_LIBRARY_VERSION}});state.issueHistory.forEach(snapshot=>snapshot.priority=normalizeSeverity(snapshot.priority))}
function categoryName(id,fallback='未分类'){return state.issueCategories.find(item=>item.id===id)?.name||fallback}
function getReviewIssues(){ensureState();const hidden=new Set(state.hiddenIssueIds);return state.issues.filter(issue=>!hidden.has(issue.id))}
function getIssueHistory(issueId){ensureState();return state.issueHistory.filter(snapshot=>snapshot.issueId===issueId).sort((a,b)=>Number(a.version)-Number(b.version))}

function save(queueServer=true){localStorage.setItem('jp-local-review-cache',JSON.stringify(state));if(!queueServer||!serverReady||(!state.project&&!state.issues.length))return;if(saveInFlight){savePending=true;return}clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,750)}
async function saveNow(){if(!serverReady||(!state.project&&!state.issues.length))return true;if(saveInFlight){savePending=true;return saveInFlight}clearTimeout(saveTimer);const payload=JSON.parse(JSON.stringify(state));saveInFlight=(async()=>{try{await serverCall('saveReview',payload);registerCurrentProjectOption();hideBanner();return true}catch(error){showBanner(`${error.message} 当前内容仍保留在本浏览器缓存中。`);return false}})();const result=await saveInFlight;saveInFlight=null;if(savePending){savePending=false;saveTimer=setTimeout(saveNow,150)}return result}
function getProjectOptions(){const projects=new Map();projectReviewOptions.forEach(review=>{const name=String(review.projectName||'').trim();if(name&&!projects.has(name))projects.set(name,review)});if(state.project)projects.set(state.project,{reviewId:state.reviewId,projectName:state.project,reviewDate:state.date});return[...projects.values()].sort((a,b)=>String(a.projectName).localeCompare(String(b.projectName),'zh-CN'))}
function renderProjectFilters(){const options=getProjectOptions(),select=$('#reviewProjectSelect');select.innerHTML=`<option value="">选择项目</option>${options.map(item=>`<option value="${escapeHtml(item.reviewId)}">${escapeHtml(item.projectName)}</option>`).join('')}`;select.value=options.some(item=>item.reviewId===state.reviewId)?state.reviewId:''}
function registerCurrentProjectOption(){if(!state.project)return;projectReviewOptions=projectReviewOptions.filter(item=>item.reviewId!==state.reviewId);projectReviewOptions.unshift({reviewId:state.reviewId,projectName:state.project,reviewDate:state.date,updatedAt:new Date().toISOString()});renderProjectFilters()}
async function loadProject(reviewId){
  if(!reviewId){if(serverReady)await saveNow();const version=state.modelVersion;state=freshState();state.modelVersion=version;applyStateToInputs();renderAll();return}
  if(reviewId===state.reviewId&&state.project){state.activeIssueId=null;state.date=today();renderReview();return}
  startOperationProgress('正在加载项目…');try{if(serverReady)await saveNow();state=await serverCall('loadReview',reviewId);state.activeIssueId=null;state.date=today();applyStateToInputs();renderAll();finishOperationProgress(true,'项目加载完成')}catch(error){finishOperationProgress(false,'项目加载失败');showBanner(error.message)}
}

function applyStateToInputs(){ensureState();$('#reviewDate').value=state.date||today();$('#modelBadge').textContent=serverReady?`已连接 · ${state.modelVersion||DEFAULT_MODEL_VERSION}`:`正在连接 · ${state.modelVersion||DEFAULT_MODEL_VERSION}`;renderCategoryOptions();renderProjectFilters();updateAiButton()}
function applyNavigationPreference(){const collapsed=localStorage.getItem(NAV_COLLAPSED_KEY)==='1';$('#appLayout').classList.toggle('nav-collapsed',collapsed)}
function toggleNavigation(){const collapsed=!$('#appLayout').classList.contains('nav-collapsed');$('#appLayout').classList.toggle('nav-collapsed',collapsed);localStorage.setItem(NAV_COLLAPSED_KEY,collapsed?'1':'0')}
function renderAll(){state.issues.forEach(refreshIssue);renderReview()}

function renderLastSaved(issue){
  const history=getIssueHistory(issue.id),latest=history.at(-1),target=$('#lastSavedCard');
  if(!latest){target.className='last-saved-card empty-save';target.innerHTML='<span class="material-symbols-rounded" aria-hidden="true">history</span><div><strong>尚无保存记录</strong><p>填写问题后，点击右上角“保存记录”，这里会显示上一次保存的主要内容。</p></div>';return}
  const answers=(latest.questions||[]).filter(question=>question.answer&&!question.skipped).slice(-2),date=String(latest.capturedAt||'').slice(0,10).replaceAll('-','/');
  const items=answers.length?answers.map(question=>`<div class="last-saved-item"><b>${escapeHtml(question.q)}</b><p>${escapeHtml(question.answer)}</p></div>`).join(''):`<div class="last-saved-item"><p>${escapeHtml(latest.updateNote||'已保存当前 Review 状态，暂未记录问题回答。')}</p></div>`;
  target.className='last-saved-card';target.innerHTML=`<div class="last-saved-head"><strong><span class="material-symbols-rounded" aria-hidden="true">history</span>上次保存</strong><span>V${latest.version||history.length} · ${date||'—'}</span></div><div class="last-saved-content">${items}</div>`
}
function renderReview(){
  const issues=getReviewIssues();let active=issues.find(issue=>issue.id===state.activeIssueId);if(!active&&issues.length){active=issues.at(-1);state.activeIssueId=active.id}renderReviewProblemList(issues);$('#reviewCount').textContent=issues.length?`${issues.filter(issue=>issue.status==='已关闭').length}/${issues.length} 已关闭`:'0 个';
  if(!active){state.activeIssueId=null;$('#reviewEmpty').classList.remove('hidden');$('#activeReviewArea').classList.add('hidden');return}
  $('#reviewEmpty').classList.add('hidden');$('#activeReviewArea').classList.remove('hidden');
  $('#focusMeta').innerHTML=`<span class="issue-meta-chip severity ${active.priority.toLowerCase()}">${active.priority}</span><span class="issue-meta-chip">${escapeHtml(categoryName(active.categoryId))}</span><span class="issue-meta-chip">${escapeHtml(TYPES.find(type=>type.id===active.type)?.name||'综合议题')}</span>`;$('#focusTitle').textContent=active.title;$('#focusReviewDate').textContent=(state.date||today()).replaceAll('-','/');
  renderLastSaved(active);renderQuestionChain(active);$('#saveIssueVersionLabel').textContent=getIssueHistory(active.id).length?'更新记录':'保存记录';updateAiButton()
}
function renderReviewProblemList(issues){const list=$('#reviewProblemList');$('#reviewProblemCount').textContent=`${issues.length} 个`;if(!issues.length){list.innerHTML='<div class="review-problem-empty">添加议题后会自动显示在这里。</div>';return}const ordered=[...issues].sort((a,b)=>Number(b.id===state.activeIssueId)-Number(a.id===state.activeIssueId));list.innerHTML=ordered.map((issue,index)=>{const history=getIssueHistory(issue.id),answered=issue.questions.filter(question=>question.answer&&!question.skipped).length;return`<button class="review-problem-card ${issue.priority.toLowerCase()} ${issue.id===state.activeIssueId?'active':''}" type="button" data-review-issue-id="${escapeHtml(issue.id)}"><span class="review-problem-meta"><b>${escapeHtml(issue.priority)} · ${index+1}</b><span>${escapeHtml(categoryName(issue.categoryId))}</span><em>${history.length?`V${history.length}`:'未保存'}</em></span><strong>${escapeHtml(issue.title)}</strong><small>已填写 ${answered} 题</small></button>`}).join('');list.scrollTop=0;$all('[data-review-issue-id]').forEach(button=>button.addEventListener('click',()=>{state.activeIssueId=button.dataset.reviewIssueId;questionLibraryFilter='all';questionLibrarySearch='';renderReview();save()}))}

function questionGroup(question){
  const library=QUESTION_CATEGORIES.find(category=>category.code===question.category);
  return library||{code:question.category||'历史',name:question.categoryName||'历史已填写问题',rule:question.rule||'—',confidence:question.confidence||'—'}
}
function renderQuestionLibraryList(issue){
  const target=$('#questionLibraryList');if(!target)return;
  const query=questionLibrarySearch.toLowerCase(),visible=issue.questions.filter(question=>(questionLibraryFilter==='all'||question.category===questionLibraryFilter)&&(!query||`${question.q} ${question.categoryName||''} ${question.rule||''}`.toLowerCase().includes(query)));
  const groups=[];visible.forEach(question=>{let group=groups.find(item=>item.code===question.category);if(!group){group={...questionGroup(question),questions:[]};groups.push(group)}group.questions.push(question)});
  target.innerHTML=groups.length?groups.map(group=>{const completed=group.questions.filter(question=>question.answer&&!question.skipped).length;return`<section class="question-library-group"><div class="question-library-group-head"><span class="question-category-code">${escapeHtml(group.code)}</span><div><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.rule)} · 置信度 ${escapeHtml(group.confidence)}</small></div><em>${completed}/${group.questions.length}</em></div><div class="question-library-items">${group.questions.map(question=>{const index=issue.questions.indexOf(question),stateLabel=question.skipped?'不适用':question.answer?(question.gap?'待确认':'已填写'):'未填写';return`<button class="question-library-card ${index===issue.questionIndex?'selected':''} ${question.answer?'answered':''} ${question.gap?'has-gap':''}" type="button" data-question-index="${index}" aria-pressed="${index===issue.questionIndex}"><span>${escapeHtml(question.q)}</span><small>${stateLabel}</small></button>`}).join('')}</div></section>`}).join(''):'<div class="question-library-empty">没有匹配的问题，换一个关键词试试。</div>';
  $all('.question-filter-chip').forEach(button=>button.classList.toggle('active',button.dataset.questionFilter===questionLibraryFilter));
  [...target.querySelectorAll('[data-question-index]')].forEach(button=>button.addEventListener('click',()=>{issue.questionIndex=Number(button.dataset.questionIndex);renderQuestionChain(issue);save()}));
}
function renderQuestionChain(issue){
  const handled=issue.questions.filter(question=>question.answer&&!question.skipped).length,total=issue.questions.length;
  if(!total){$('#questionProgress').textContent='0/0 已处理';$('#questionChain').innerHTML='<div class="review-problem-empty">当前没有问题。</div>';return}
  if(issue.questionIndex<0||issue.questionIndex>=total)issue.questionIndex=0;
  const index=issue.questionIndex,question=issue.questions[index],group=questionGroup(question),libraryTotal=issue.questions.filter(item=>item.source==='library').length,extraTotal=total-libraryTotal,filters=[{code:'all',name:'全部'},...QUESTION_CATEGORIES.map(category=>({code:category.code,name:category.name}))];
  $('#questionProgress').textContent=`已填写 ${handled} 题 · ${libraryTotal} 道库题${extraTotal?` · ${extraTotal} 条历史/AI`:''} · 自主选择`;
  $('#questionChain').innerHTML=`<div class="question-library-toolbar"><label class="question-search"><span class="material-symbols-rounded" aria-hidden="true">search</span><input id="questionLibrarySearch" type="search" value="${escapeHtml(questionLibrarySearch)}" placeholder="搜索问题、分类或规则" aria-label="搜索 Review 问题"></label><div class="question-category-filters" aria-label="问题分类筛选">${filters.map(filter=>`<button class="question-filter-chip ${filter.code===questionLibraryFilter?'active':''}" type="button" data-question-filter="${filter.code}" title="${escapeHtml(filter.name)}">${filter.code==='all'?'全部':filter.code}</button>`).join('')}</div></div><div class="question-library-layout"><div class="question-library-list" id="questionLibraryList" aria-label="全部 Review 问题"></div><div class="question-stage"><div class="question-item expanded ${question.answer||question.skipped?'answered':''}" data-question-index="${index}"><div class="question-editor-meta"><span class="question-category-code">${escapeHtml(group.code)}</span><span>${escapeHtml(group.name)}</span><i>${escapeHtml(group.rule)} · 置信度 ${escapeHtml(group.confidence)}</i></div><div class="question-toggle"><span class="question-copy"><b>${escapeHtml(question.q)}</b><small>选择这个问题后，记录 Team Member 的事实、数字、判断或引用。</small></span><span class="question-state">${question.gap?'待确认':question.answer?'已填写':'未填写'}</span></div><div class="question-answer-panel"><div class="question-answer-inner"><label>Team Member 回答 / 现场记录</label><textarea class="question-answer" maxlength="1000" placeholder="记录事实、数字或引用">${escapeHtml(question.answer)}</textarea><div class="quick-actions"><button class="quick" type="button" data-quick="不清楚，需要会后确认。"><span class="material-symbols-rounded" aria-hidden="true">help</span>不清楚</button><button class="quick" type="button" data-quick="已有口头结论，但没有书面记录。"><span class="material-symbols-rounded" aria-hidden="true">chat</span>仅口头</button><button class="quick" type="button" data-quick="专业负责人尚未确认。"><span class="material-symbols-rounded" aria-hidden="true">verified_user</span>未专业确认</button><button class="quick" type="button" data-quick="当前没有明确的完成时间。"><span class="material-symbols-rounded" aria-hidden="true">schedule</span>无时间</button></div><div class="actions"><button class="btn primary save-question" type="button"><span class="material-symbols-rounded" aria-hidden="true">check</span>保存回答</button><button class="btn secondary gap-question" type="button"><span class="material-symbols-rounded" aria-hidden="true">add_box</span>保存并标记待确认</button>${question.answer||question.skipped?'<button class="btn neutral clear-question" type="button">清除</button>':''}</div>${question.gap?'<div class="gap">需要后续确认</div>':''}</div></div><div class="saved-feedback" id="savedFeedback"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span>已保存<div class="save-particles">${Array.from({length:7},()=>'<i class="save-particle"></i>').join('')}</div></div></div></div></div>`;
  renderQuestionLibraryList(issue);
  const item=$('.question-item'),search=$('#questionLibrarySearch');item.querySelectorAll('.quick').forEach(button=>button.addEventListener('click',()=>{item.querySelector('.question-answer').value=button.dataset.quick;item.querySelector('.question-answer').focus()}));item.querySelector('.save-question').addEventListener('click',()=>recordAnswer(index,false));item.querySelector('.gap-question').addEventListener('click',()=>recordAnswer(index,true));item.querySelector('.clear-question')?.addEventListener('click',()=>clearAnswer(index));search.addEventListener('input',()=>{questionLibrarySearch=search.value.trim();renderQuestionLibraryList(issue)});$all('[data-question-filter]').forEach(button=>button.addEventListener('click',()=>{questionLibraryFilter=button.dataset.questionFilter;renderQuestionLibraryList(issue)}));requestAnimationFrame(animateQuestionStage)
}
function recordAnswer(index,gap){const issue=state.issues.find(item=>item.id===state.activeIssueId),question=issue?.questions[index],item=$(`.question-item[data-question-index="${index}"]`);if(!question||!item)return;const answer=item.querySelector('.question-answer').value.trim();if(!answer&&!gap){item.querySelector('.question-answer').focus();return}question.answer=answer||'不清楚，需要会后确认。';question.skipped=false;question.gap=gap||/不清楚|不知道|没有|未确认|待确认|口头/.test(question.answer);issue.questionIndex=index;renderReview();requestAnimationFrame(animateSavedFeedback);save()}
function clearAnswer(index){const issue=state.issues.find(item=>item.id===state.activeIssueId),question=issue?.questions[index];if(!question)return;question.answer='';question.skipped=false;question.gap=false;issue.questionIndex=index;renderReview();save()}

function createIssueSnapshot(issue,meta={}){refreshIssue(issue);const snapshot=JSON.parse(JSON.stringify(issue));snapshot.issueId=issue.id;snapshot.snapshotId=uid('V');snapshot.version=meta.version||1;snapshot.capturedAt=dateStamp(meta.date||state.date);snapshot.updateNote=meta.updateNote||'';snapshot.categoryName=categoryName(issue.categoryId);return snapshot}
function changeSummary(previous,issue){if(!previous)return'首次记录';const fields=[['text','议题描述'],['priority','严重度'],['categoryId','分类'],['status','状态']],changes=fields.filter(([key])=>String(previous[key]||'')!==String(issue[key]||'')).map(([,label])=>label);if(JSON.stringify(previous.questions||[])!==JSON.stringify(issue.questions||[]))changes.push('现场问答');return changes.length?`更新了：${changes.join('、')}`:'本次确认，无字段变化'}
async function saveActiveVersion(){const issue=state.issues.find(item=>item.id===state.activeIssueId);if(!issue)return;const history=getIssueHistory(issue.id),latest=history.at(-1),snapshot=createIssueSnapshot(issue,{version:(latest?.version||0)+1,date:state.date,updateNote:changeSummary(latest,issue)});state.issueHistory.push(snapshot);state.hiddenIssueIds=state.hiddenIssueIds.filter(id=>id!==issue.id);startOperationProgress(latest?'正在更新问题记录…':'正在保存问题记录…');const saved=await saveNow();if(saved){renderAll();finishOperationProgress(true,latest?'问题记录已更新':'问题已保存')}else finishOperationProgress(false,'保存失败，请检查提示后重试')}
function saveUnsavedIssues(){getReviewIssues().forEach(issue=>{if(!getIssueHistory(issue.id).length)state.issueHistory.push(createIssueSnapshot(issue,{version:1,date:state.date,updateNote:'首次记录'}))})}

function getAiConfig(){let stored={};try{stored=JSON.parse(localStorage.getItem(AI_CONFIG_KEY)||'{}')}catch{}return{endpoint:stored.endpoint||'',model:stored.model||'',apiKey:sessionStorage.getItem(`${AI_CONFIG_KEY}-key`)||''}}
function updateAiButton(){const config=getAiConfig(),button=$('#generateAiQuestions');button.textContent=aiBusy?'AI 正在分析…':config.endpoint&&config.model&&config.apiKey?'AI 扩展问题':'先设置 AI';button.disabled=aiBusy}
function openAiSettings(){const config=getAiConfig();$('#aiEndpoint').value=config.endpoint;$('#aiModel').value=config.model;$('#aiApiKey').value=config.apiKey;$('#aiSettingsModal').classList.remove('hidden')}
function closeAiSettings(){$('#aiSettingsModal').classList.add('hidden')}
function saveAiSettings(){const endpoint=$('#aiEndpoint').value.trim(),model=$('#aiModel').value.trim(),apiKey=$('#aiApiKey').value.trim();if(!endpoint||!model||!apiKey){alert('请完整填写 Endpoint、Model 和 API Key。');return}if(!/^https:\/\//i.test(endpoint)){alert('Endpoint 必须使用 HTTPS。');return}localStorage.setItem(AI_CONFIG_KEY,JSON.stringify({endpoint,model}));sessionStorage.setItem(`${AI_CONFIG_KEY}-key`,apiKey);closeAiSettings();updateAiButton();$('#aiStatus').textContent='AI 已设置，扩展问题专用提示词已启用。';$('#aiStatus').className='ai-status good'}
function clearAiSettings(){localStorage.removeItem(AI_CONFIG_KEY);sessionStorage.removeItem(`${AI_CONFIG_KEY}-key`);$('#aiEndpoint').value='';$('#aiModel').value='';$('#aiApiKey').value='';updateAiButton()}
async function generateAiQuestions(){const issue=state.issues.find(item=>item.id===state.activeIssueId),config=getAiConfig();if(!issue)return;if(!config.endpoint||!config.model||!config.apiKey){openAiSettings();return}aiBusy=true;updateAiButton();$('#aiStatus').className='ai-status';$('#aiStatus').textContent='正在读取已填写问题和 Team Member 现场回答…';try{const result=await serverCall('generateAiQuestions',{project:state.project,topic:issue.text,questions:issue.questions.filter(item=>item.answer||item.source==='ai').map(item=>({question:item.q,answer:item.answer||'',skipped:Boolean(item.skipped)}))},config),existing=new Set(issue.questions.map(item=>clean(item.q).toLowerCase())),additions=(result.questions||[]).map(clean).filter(question=>question&&!existing.has(question.toLowerCase())).slice(0,5);additions.forEach((q,index)=>issue.questions.push({id:`AI${Date.now()}-${index+1}`,category:'AI',categoryName:'AI 扩展问题',rule:'AI',confidence:'基于当前输入',q,answer:'',skipped:false,gap:false,source:'ai'}));if(!additions.length)throw new Error('AI 没有返回新的有效问题。');issue.questionIndex=issue.questions.length-additions.length;questionLibraryFilter='AI';$('#aiStatus').className='ai-status good';$('#aiStatus').textContent=`已新增 ${additions.length} 个 AI 扩展问题。`;renderReview();save()}catch(error){$('#aiStatus').className='ai-status error';$('#aiStatus').textContent=`AI 扩展失败：${error.message}`}finally{aiBusy=false;updateAiButton()}}

function renderCategoryOptions(){ensureState();const select=$('#newIssueCategory'),current=select.value;select.innerHTML=`<option value="">选择分类</option>${state.issueCategories.map(category=>`<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}`;if(state.issueCategories.some(category=>category.id===current))select.value=current}
function openCategoryModal(){renderCategoryManager();$('#categoryModal').classList.remove('hidden')}
function closeCategoryModal(){$('#categoryModal').classList.add('hidden');renderCategoryOptions()}
function renderCategoryManager(){$('#categoryList').innerHTML=state.issueCategories.length?state.issueCategories.map(category=>`<div class="category-row"><input value="${escapeHtml(category.name)}" data-category-name="${escapeHtml(category.id)}"><button class="btn secondary small save-category" type="button" data-category-id="${escapeHtml(category.id)}">保存</button><button class="btn danger small delete-category" type="button" data-category-id="${escapeHtml(category.id)}">删除</button></div>`).join(''):'<div class="category-empty">尚未创建分类</div>';$all('.save-category').forEach(button=>button.addEventListener('click',()=>renameCategory(button.dataset.categoryId)));$all('.delete-category').forEach(button=>button.addEventListener('click',()=>deleteCategory(button.dataset.categoryId)))}
function addCategory(){const name=$('#newCategoryName').value.trim();if(!name){$('#newCategoryName').focus();return}state.issueCategories.push({id:uid('C'),name,typeId:''});$('#newCategoryName').value='';renderCategoryManager();renderCategoryOptions();save()}
function renameCategory(id){const category=state.issueCategories.find(item=>item.id===id),name=$(`[data-category-name="${id}"]`)?.value.trim();if(!category||!name)return;category.name=name;state.issueHistory.forEach(snapshot=>{if(snapshot.categoryId===id)snapshot.categoryName=name});renderCategoryManager();renderAll();save()}
function deleteCategory(id){const category=state.issueCategories.find(item=>item.id===id);if(!category||!confirm(`删除分类“${category.name}”吗？已保存的履历会保留原分类名称。`))return;state.issueCategories=state.issueCategories.filter(item=>item.id!==id);state.issues.forEach(issue=>{if(issue.categoryId===id)issue.categoryId=''});renderCategoryManager();renderAll();save()}

function editIssue(){const issue=state.issues.find(item=>item.id===state.activeIssueId);if(!issue)return;const text=prompt('修改议题内容：',issue.text);if(text===null||!text.trim())return;issue.text=clean(text);issue.title=titleFor(issue.text,issue.type,0);const severity=prompt('严重度（S1/S2/S3）：',issue.priority)?.toUpperCase();if(['S1','S2','S3'].includes(severity))issue.priority=severity;renderReview();save()}

function addIssue(){const text=$('#newIssueText').value.trim(),priority=$('#newIssuePriority').value,categoryId=$('#newIssueCategory').value;if(!state.project){alert('请先选择项目。');return}if(!text){$('#newIssueText').focus();return}if(!priority){$('#newIssuePriority').focus();return}if(!categoryId){$('#newIssueCategory').focus();return}const issue=buildIssue(text,priority,categoryId);state.issues.push(issue);state.activeIssueId=issue.id;$('#newIssueText').value='';$('#newIssuePriority').value='';renderReview();animateIn($(`[data-review-issue-id="${issue.id}"]`));save()}
function deleteActiveIssue(){const issue=state.issues.find(item=>item.id===state.activeIssueId);if(!issue)return;if(getIssueHistory(issue.id).length){alert('已保存的问题需要保留历史版本，不能在这里删除。');return}if(!confirm(`确定删除草稿“${issue.title}”吗？`))return;state.issues=state.issues.filter(item=>item.id!==issue.id);state.activeIssueId=null;renderReview();save()}
async function finishReview(){if(finishBusy)return;if(!getReviewIssues().length){alert('请先记录至少一个 Review 议题。');return}finishBusy=true;const button=$('#finishReview'),old=button.innerHTML;button.disabled=true;button.innerHTML='<span class="material-symbols-rounded" aria-hidden="true">progress_activity</span>正在生成';startOperationProgress('正在保存 Review 记录…');try{saveUnsavedIssues();state.reviewStatus='reviewed';const saved=await saveNow();if(!saved){finishOperationProgress(false,'保存失败，请检查提示后重试');return}renderAll();finishOperationProgress(true,'Review 记录已保存')}finally{finishBusy=false;button.disabled=false;button.innerHTML=old}}

function bindEvents(){
  $('#reviewProjectSelect').addEventListener('change',event=>loadProject(event.target.value));$('#reviewDate').addEventListener('change',event=>{state.date=event.target.value||today();save()});
  $('#addIssue').addEventListener('click',addIssue);$('#saveIssueVersion').addEventListener('click',saveActiveVersion);$('#editCurrentIssue').addEventListener('click',editIssue);$('#deleteCurrentIssue').addEventListener('click',deleteActiveIssue);$('#finishReview').addEventListener('click',finishReview);
  $('#navCollapseBottom').addEventListener('click',toggleNavigation);
  $('#openAiSettings').addEventListener('click',openAiSettings);$('#closeAiSettings').addEventListener('click',closeAiSettings);$('#saveAiSettings').addEventListener('click',saveAiSettings);$('#clearAiSettings').addEventListener('click',clearAiSettings);$('#generateAiQuestions').addEventListener('click',generateAiQuestions);$('#aiSettingsModal').addEventListener('click',event=>{if(event.target.id==='aiSettingsModal')closeAiSettings()});
  $('#manageIssueCategories').addEventListener('click',openCategoryModal);$('#closeCategoryModal').addEventListener('click',closeCategoryModal);$('#categoryModal').addEventListener('click',event=>{if(event.target.id==='categoryModal')closeCategoryModal()});$('#addIssueCategory').addEventListener('click',addCategory);$('#newCategoryName').addEventListener('keydown',event=>{if(event.key==='Enter')addCategory()});
  window.addEventListener('beforeunload',()=>save(false))
}

boot();
