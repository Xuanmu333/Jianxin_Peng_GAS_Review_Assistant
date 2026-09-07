import './load-env.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReviewStore } from './review-store.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, '..');
const publicDir = path.join(projectDir, 'public');
const dataDir = path.resolve(process.env.REVIEW_DATA_DIR || path.join(projectDir, 'data'));
const backupDir = path.resolve(process.env.REVIEW_BACKUP_DIR || path.join(projectDir, 'backups'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const store = createReviewStore({ dataDir, backupDir });

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

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, storage: 'local-json' });
    return;
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
  if (process.env.NO_OPEN === '1') return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'darwin' ? [url] : process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // The URL is printed below, so a missing desktop opener does not stop the server.
  }
}

await store.initialize();
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
  console.log(`本地数据文件：${store.databaseFile}`);
  openBrowser(url);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用，请关闭旧的应用窗口后重试。`);
  else console.error(error.message);
  process.exitCode = 1;
});
