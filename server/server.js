import './load-env.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateAiQuestions, generateAiReport } from './ai-service.js';
import { createAuthService } from './auth-service.js';
import { createReviewStore } from './review-store.js';
import { createSheetsStore } from './sheets-store.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, '..');
const publicDir = path.join(projectDir, 'public');
const dataDir = path.resolve(process.env.REVIEW_DATA_DIR || path.join(projectDir, 'data'));
const backupDir = path.resolve(process.env.REVIEW_BACKUP_DIR || path.join(projectDir, 'backups'));
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const spreadsheetId = String(process.env.REVIEW_SPREADSHEET_ID || '').trim();
const store = spreadsheetId
  ? createSheetsStore({ spreadsheetId, issuesSheet: process.env.ISSUES_SHEET_NAME || 'Issues', questionsSheet: process.env.QUESTIONS_SHEET_NAME || 'Questions', modelDataFile: path.join(publicDir, 'model-data.js') })
  : createReviewStore({ dataDir, backupDir });
const authService = createAuthService({
  spreadsheetId,
  accessSheet: process.env.ACCESS_REQUESTS_SHEET_NAME || 'AccessRequests',
  dataDir
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, {
    Location: location,
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end();
}

function assertSameOrigin(request) {
  const origin = String(request.headers.origin || '').trim();
  if (!origin) return;
  let originHost = '';
  try { originHost = new URL(origin).host; }
  catch { throw Object.assign(new Error('请求来源无效。'), { statusCode: 403 }); }
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (originHost !== (forwardedHost || request.headers.host)) {
    throw Object.assign(new Error('请求来源未通过安全校验。'), { statusCode: 403 });
  }
}

async function requireAccess(request, { edit = false, admin = false } = {}) {
  const session = await authService.getSession(request);
  if (!session.authenticated) throw Object.assign(new Error('请先登录。'), { statusCode: 401 });
  if (admin && !session.access.isAdmin) throw Object.assign(new Error('只有管理员可以执行此操作。'), { statusCode: 403 });
  if (!admin && !session.access.allowed) throw Object.assign(new Error('账号尚未获得访问授权。'), { statusCode: 403 });
  if (edit && !session.access.canEdit) throw Object.assign(new Error('当前账号只有只读权限。'), { statusCode: 403 });
  return session;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw Object.assign(new Error('请求数据超过 10 MB。'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求 JSON 格式无效。'), { statusCode: 400 }); }
}

async function serveStatic(request, response, pathname) {
  if (pathname === '/vendor/gsap.min.js') {
    const gsapFile = path.join(projectDir, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
    const fileStat = await stat(gsapFile);
    response.writeHead(200, {
      'Content-Type': mimeTypes['.js'],
      'Content-Length': fileStat.size,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(gsapFile).pipe(response);
    return;
  }
  if (pathname === '/vendor/material-symbols.css' || pathname === '/vendor/material-symbols-rounded.woff2') {
    const filename = pathname.endsWith('.css') ? 'rounded.css' : 'material-symbols-rounded.woff2';
    const assetFile = path.join(projectDir, 'node_modules', '@material-symbols', 'font-400', filename);
    const fileStat = await stat(assetFile);
    response.writeHead(200, {
      'Content-Type': pathname.endsWith('.css') ? mimeTypes['.css'] : mimeTypes['.woff2'],
      'Content-Length': fileStat.size,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(assetFile).pipe(response);
    return;
  }
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relativePath);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    sendJson(response, 403, { error: '禁止访问该路径。' });
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') sendJson(response, 404, { error: '页面不存在。' });
    else throw error;
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  const reviewMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
  const adminRequestMatch = url.pathname.match(/^\/api\/admin\/access-requests\/([^/]+)$/);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, storage: spreadsheetId ? 'google-sheets' : 'local-json', authConfigured: authService.isConfigured() });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    sendJson(response, 200, await authService.getSession(request));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/google') {
    const result = await authService.beginGoogle(request, url.searchParams.get('returnTo') || '/');
    redirect(response, result.redirect, result.cookies);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/google/callback') {
    try {
      const result = await authService.completeGoogle(request, Object.fromEntries(url.searchParams));
      redirect(response, result.redirect, result.cookies);
    } catch (error) {
      redirect(response, `/login.html?state=error&message=${encodeURIComponent(error.message)}`);
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/signout') {
    assertSameOrigin(request);
    response.writeHead(204, { 'Set-Cookie': authService.signOut(request), 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/access-requests') {
    assertSameOrigin(request);
    sendJson(response, 200, await authService.requestAccess(request, await readJson(request)));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/access-requests') {
    sendJson(response, 200, await authService.listRequests(request));
    return;
  }
  if (adminRequestMatch && request.method === 'PATCH') {
    assertSameOrigin(request);
    sendJson(response, 200, await authService.decide(request, decodeURIComponent(adminRequestMatch[1]), await readJson(request)));
    return;
  }
  if (['GET', 'HEAD'].includes(request.method) && ['/login', '/login.html'].includes(url.pathname)) {
    const session = await authService.getSession(request);
    if (session.access.allowed) redirect(response, url.searchParams.get('returnTo') || '/');
    else await serveStatic(request, response, '/login.html');
    return;
  }
  if (['GET', 'HEAD'].includes(request.method) && ['/admin', '/admin.html'].includes(url.pathname)) {
    const session = await authService.getSession(request);
    if (!session.authenticated) redirect(response, '/login.html?state=signed_out&returnTo=%2Fadmin.html');
    else if (!session.access.isAdmin) redirect(response, '/');
    else await serveStatic(request, response, '/admin.html');
    return;
  }
  if (['GET', 'HEAD'].includes(request.method) && ['/', '/index.html'].includes(url.pathname)) {
    const session = await authService.getSession(request);
    if (!session.authenticated || !session.access.allowed) redirect(response, `/login.html?state=${session.authenticated ? session.access.status : 'signed_out'}`);
    else await serveStatic(request, response, '/index.html');
    return;
  }
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/questions/sync') {
    const edit = request.method !== 'GET' || url.pathname.startsWith('/api/ai/');
    await requireAccess(request, { edit });
    if (edit) assertSameOrigin(request);
  }
  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    sendJson(response, 200, await store.getBootstrap());
    return;
  }
  if (reviewMatch && request.method === 'GET') {
    sendJson(response, 200, await store.loadReview(decodeURIComponent(reviewMatch[1])));
    return;
  }
  if (reviewMatch && request.method === 'PUT') {
    const reviewId = decodeURIComponent(reviewMatch[1]);
    const payload = await readJson(request);
    if (String(payload.reviewId || '') !== reviewId) throw Object.assign(new Error('URL 和数据中的 reviewId 不一致。'), { statusCode: 400 });
    sendJson(response, 200, await store.saveReview(payload));
    return;
  }
  if (reviewMatch && request.method === 'DELETE') {
    sendJson(response, 200, await store.deleteReview(decodeURIComponent(reviewMatch[1])));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/ai/questions') {
    const body = await readJson(request);
    sendJson(response, 200, await generateAiQuestions(body.context, body.config));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/ai/report') {
    const body = await readJson(request);
    sendJson(response, 200, await generateAiReport(body.context, body.config));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/questions/sync') {
    if (!spreadsheetId || typeof store.syncQuestions !== 'function') throw Object.assign(new Error('Google Sheets 提问库尚未启用。'), { statusCode: 503 });
    const expected = String(process.env.QUESTION_SYNC_TOKEN || '');
    if (!expected) throw Object.assign(new Error('问题同步入口尚未配置。'), { statusCode: 503 });
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (supplied !== expected) throw Object.assign(new Error('问题同步凭据无效。'), { statusCode: 401 });
    const body = await readJson(request);
    sendJson(response, 200, await store.syncQuestions(body.questions));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: '本地 API 不存在。' });
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    sendJson(response, 405, { error: '不支持该请求方法。' });
    return;
  }
  await serveStatic(request, response, url.pathname);
}

function openBrowser(url) {
  if (process.env.NO_OPEN === '1' || process.env.K_SERVICE) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'darwin' ? [url] : process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => {});
    child.unref();
  } catch {
    // The URL is printed below, so a missing desktop opener does not stop the server.
  }
}

await Promise.all([store.initialize(), authService.initialize()]);
const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    const statusCode = Number(error.statusCode || 500);
    if (statusCode >= 500) console.error(`[${new Date().toISOString()}]`, error.message);
    if (!response.headersSent) sendJson(response, statusCode, { error: error.message || '本地服务发生错误。' });
    else response.end();
  });
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`问题管理系统已启动：${url}`);
  console.log(`数据存储：${store.databaseFile}`);
  console.log(`授权存储：${authService.databaseFile}`);
  openBrowser(url);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用，请关闭旧的应用窗口后重试。`);
  else console.error(error.message);
  process.exitCode = 1;
});
