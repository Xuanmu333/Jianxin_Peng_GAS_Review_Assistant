const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
let requests = [];
let activeStatus = 'pending';

function labelFor(status) {
  return status === 'approved' ? '已授权' : status === 'rejected' ? '已拒绝' : '待审批';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function render() {
  $('#pendingCount').textContent = requests.filter(item => item.Status === 'pending').length;
  $('#approvedCount').textContent = requests.filter(item => item.Status === 'approved').length;
  $('#rejectedCount').textContent = requests.filter(item => item.Status === 'rejected').length;
  const query = $('#requestSearch').value.trim().toLowerCase();
  const visible = requests.filter(item => (activeStatus === 'all' || item.Status === activeStatus) && (!query || `${item.Name} ${item.Email} ${item.Department}`.toLowerCase().includes(query)));
  $('#requestRows').innerHTML = visible.map(item => {
    const initials = (item.Name || item.Email || '?').trim().slice(0, 1).toUpperCase();
    const pending = item.Status === 'pending';
    return `<article class="request-row" data-email="${esc(item.Email)}">
      <div class="request-user"><span class="request-avatar">${esc(initials)}</span><p><strong>${esc(item.Name || '未填写姓名')}</strong><small>${esc(item.Email)} · ${esc(item.Department || '未填写部门')}</small></p></div>
      <div class="request-reason"><p title="${esc(item.Reason)}">${esc(item.Reason || '未说明')}</p><small>${esc(formatDate(item.RequestedAt))}</small></div>
      <span class="status-pill ${esc(item.Status)}">${labelFor(item.Status)}</span>
      <select class="role-select" aria-label="授权级别" ${pending ? '' : 'disabled'}><option value="viewer" ${item.Role !== 'editor' ? 'selected' : ''}>只读</option><option value="editor" ${item.Role === 'editor' ? 'selected' : ''}>可编辑</option></select>
      <div class="row-actions">${pending ? '<button class="approve" type="button" data-action="approve">批准</button><button class="reject" type="button" data-action="reject">拒绝</button>' : `<button type="button" data-action="${item.Status === 'approved' ? 'reject' : 'approve'}">${item.Status === 'approved' ? '撤销授权' : '重新批准'}</button>`}</div>
    </article>`;
  }).join('') || '<div class="empty-requests">当前筛选条件下没有访问申请。</div>';

  $$('.request-row [data-action]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('.request-row');
    const email = row.dataset.email;
    const action = button.dataset.action;
    const role = row.querySelector('.role-select').value;
    button.disabled = true;
    button.textContent = '处理中…';
    try {
      const response = await fetch(`/api/admin/access-requests/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, role })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '审批失败');
      const index = requests.findIndex(item => item.Email === email);
      if (index >= 0) requests[index] = data.request;
      render();
    } catch (error) {
      button.disabled = false;
      button.textContent = action === 'approve' ? '批准' : '拒绝';
      window.alert(error.message);
    }
  }));
}

async function load() {
  const response = await fetch('/api/admin/access-requests', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法读取访问申请');
  requests = data.requests.map(item => ({ ...item, Status: String(item.Status || 'pending').toLowerCase(), Role: String(item.Role || 'viewer').toLowerCase() }));
  $('#adminIdentity').textContent = `管理员 · ${data.currentUser.email}`;
  render();
}

$$('.admin-tab').forEach(button => button.addEventListener('click', () => {
  activeStatus = button.dataset.status;
  $$('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
  render();
}));
$('#requestSearch').addEventListener('input', render);
$('#signOut').addEventListener('click', async () => {
  await fetch('/api/auth/signout', { method: 'POST' });
  location.href = '/login.html';
});

load().catch(error => { $('#requestRows').innerHTML = `<div class="empty-requests">${esc(error.message)}</div>`; });
