const $ = selector => document.querySelector(selector);
let session = null;

function setNotice(type, title, message, icon = 'info') {
  const notice = $('#authNotice');
  notice.hidden = false;
  notice.className = `auth-notice ${type || ''}`;
  $('#authNoticeTitle').textContent = title;
  $('#authNoticeText').textContent = message;
  $('#authNoticeIcon').textContent = icon;
}

function openRequestForm() {
  if (!session?.authenticated) {
    location.href = '/auth/google?returnTo=' + encodeURIComponent('/login.html?state=request');
    return;
  }
  $('#accessForm').hidden = false;
  $('#requestIdentity').textContent = `以 ${session.email} 申请访问`;
  $('#accessForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadSession() {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  session = await response.json();
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || session.access?.status;
  const returnTo = params.get('returnTo') || '/';
  $('#googleLogin').href = `/auth/google?returnTo=${encodeURIComponent(returnTo)}`;

  if (!session.configured) {
    $('#googleLogin').setAttribute('aria-disabled', 'true');
    setNotice('error', '登录尚未配置', '管理员需要先配置 Google OAuth 和会话密钥。', 'settings');
  } else if (session.authenticated) {
    $('#googleLogin span').textContent = '使用其他 Google 账号';
    if (state === 'pending') setNotice('pending', '申请正在审批', `账号 ${session.email} 的申请尚未完成审批。`, 'schedule');
    if (state === 'rejected') setNotice('rejected', '访问申请未通过', '你可以更新访问原因后重新提交申请。', 'block');
    if (state === 'request' || state === 'not_requested' || state === 'rejected') openRequestForm();
  }

  if (state === 'error') setNotice('error', '登录失败', params.get('message') || '请重新尝试 Google 登录。', 'error');
}

$('#requestAccess').addEventListener('click', openRequestForm);
$('#closeAccessForm').addEventListener('click', () => { $('#accessForm').hidden = true; });
$('#accessForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const status = $('#requestStatus');
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = '正在提交…';
  try {
    const response = await fetch('/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: $('#requestDepartment').value.trim(), reason: $('#requestReason').value.trim() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '提交失败');
    status.textContent = '申请已提交。管理员审批后，你可以直接登录进入工作台。';
    setNotice('pending', '申请正在审批', `账号 ${data.email} 的申请已提交。`, 'schedule');
  } catch (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
  } finally { button.disabled = false; }
});

loadSession().catch(() => setNotice('error', '无法检查登录状态', '请刷新页面后重试。', 'error'));
