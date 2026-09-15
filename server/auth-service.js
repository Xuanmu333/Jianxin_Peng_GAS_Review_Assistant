import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';

const ACCESS_HEADERS = [
  'RequestID', 'Email', 'Name', 'Department', 'Reason', 'Status', 'Role',
  'RequestedAt', 'UpdatedAt', 'ReviewedAt', 'ReviewedBy', 'ReviewNote'
];
const SESSION_COOKIE = 'issues_session';
const STATE_COOKIE = 'issues_oauth_state';
const SESSION_SECONDS = 8 * 60 * 60;
const STATE_SECONDS = 10 * 60;

const text = value => value === null || value === undefined ? '' : String(value);
const normalizeEmail = value => text(value).trim().toLowerCase();
const quoteSheet = name => `'${text(name).replace(/'/g, "''")}'`;

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function parseCookies(request) {
  return Object.fromEntries(text(request.headers.cookie).split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function safeReturnTo(value) {
  const candidate = text(value).trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/auth/')) return '/';
  return candidate;
}

function requestBaseUrl(request) {
  const configured = text(process.env.AUTH_URL).trim().replace(/\/$/, '');
  if (configured) return configured;
  const protocol = text(request.headers['x-forwarded-proto']).split(',')[0].trim() || 'http';
  return `${protocol}://${request.headers.host}`;
}

function cookie(name, value, request, { maxAge, path: cookiePath = '/', httpOnly = true } = {}) {
  const secure = requestBaseUrl(request).startsWith('https://');
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${cookiePath}`,
    'SameSite=Lax',
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
    Number.isFinite(maxAge) ? `Max-Age=${Math.max(0, Math.floor(maxAge))}` : ''
  ].filter(Boolean).join('; ');
}

function rowObject(row) {
  return Object.fromEntries(ACCESS_HEADERS.map((header, index) => [header, row[index] ?? '']));
}

function rowValues(record) {
  return ACCESS_HEADERS.map(header => record[header] ?? '');
}

function createAccessStore({ spreadsheetId, sheetName, dataDir }) {
  const localFile = path.join(dataDir, 'access-requests.json');
  const range = `${quoteSheet(sheetName)}!A:L`;
  const sheetAuth = spreadsheetId ? new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) : null;
  const sheets = sheetAuth ? google.sheets({ version: 'v4', auth: sheetAuth }) : null;
  let localQueue = Promise.resolve();

  async function ensureLocal() {
    await mkdir(dataDir, { recursive: true });
    try { await readFile(localFile, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(localFile, `${JSON.stringify({ requests: [] }, null, 2)}\n`, 'utf8');
    }
  }

  async function readLocal() {
    await ensureLocal();
    const parsed = JSON.parse(await readFile(localFile, 'utf8'));
    return Array.isArray(parsed.requests) ? parsed.requests : [];
  }

  async function writeLocal(requests) {
    await ensureLocal();
    const temporary = `${localFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ requests }, null, 2)}\n`, 'utf8');
    await rename(temporary, localFile);
  }

  async function ensureSheet() {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
    const exists = (metadata.data.sheets || []).some(sheet => sheet.properties?.title === sheetName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName, gridProperties: { rowCount: 1000, columnCount: 20 } } } }] }
      });
    }
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quoteSheet(sheetName)}!1:1` });
    const headers = response.data.values?.[0] || [];
    if (!headers.some(Boolean)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(sheetName)}!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: { values: [ACCESS_HEADERS] }
      });
    } else if (ACCESS_HEADERS.some((header, index) => headers[index] !== header)) {
      throw new Error(`工作表 ${sheetName} 的列结构不兼容。`);
    }
  }

  async function list() {
    if (!sheets) return readLocal();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return (response.data.values || []).slice(1).map(rowObject).filter(record => record.Email);
  }

  async function save(record) {
    if (!sheets) {
      localQueue = localQueue.catch(() => undefined).then(async () => {
        const requests = await readLocal();
        const index = requests.findIndex(item => normalizeEmail(item.Email) === normalizeEmail(record.Email));
        if (index >= 0) requests[index] = record;
        else requests.push(record);
        await writeLocal(requests);
      });
      await localQueue;
      return record;
    }
    const records = await list();
    const index = records.findIndex(item => normalizeEmail(item.Email) === normalizeEmail(record.Email));
    if (index >= 0) {
      const row = index + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(sheetName)}!A${row}:L${row}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowValues(record)] }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues(record)] }
      });
    }
    return record;
  }

  return {
    databaseFile: sheets ? `Google Sheets:${spreadsheetId}/${sheetName}` : localFile,
    async initialize() { if (sheets) await ensureSheet(); else await ensureLocal(); },
    async findByEmail(email) { return (await list()).find(item => normalizeEmail(item.Email) === normalizeEmail(email)) || null; },
    async list() { return (await list()).sort((a, b) => text(b.UpdatedAt).localeCompare(text(a.UpdatedAt))); },
    async request(identity, input) {
      const existing = await this.findByEmail(identity.email);
      if (text(existing?.Status).toLowerCase() === 'approved') return existing;
      const now = new Date().toISOString();
      return save({
        RequestID: existing?.RequestID || `ACCESS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
        Email: normalizeEmail(identity.email),
        Name: text(identity.name || existing?.Name).trim(),
        Department: text(input.department || existing?.Department).trim(),
        Reason: text(input.reason || existing?.Reason).trim(),
        Status: 'pending',
        Role: text(existing?.Role || 'viewer').toLowerCase(),
        RequestedAt: existing?.RequestedAt || now,
        UpdatedAt: now,
        ReviewedAt: '',
        ReviewedBy: '',
        ReviewNote: ''
      });
    },
    async decide(email, { action, role, note, reviewer }) {
      const existing = await this.findByEmail(email);
      if (!existing) throw httpError('找不到这条访问申请。', 404);
      const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : '';
      if (!status) throw httpError('审批动作无效。', 400);
      const now = new Date().toISOString();
      return save({
        ...existing,
        Status: status,
        Role: status === 'approved' && role === 'editor' ? 'editor' : 'viewer',
        UpdatedAt: now,
        ReviewedAt: now,
        ReviewedBy: normalizeEmail(reviewer),
        ReviewNote: text(note).trim()
      });
    }
  };
}

export function createAuthService({ spreadsheetId, accessSheet = 'AccessRequests', dataDir }) {
  const clientId = text(process.env.GOOGLE_CLIENT_ID).trim();
  const clientSecret = text(process.env.GOOGLE_CLIENT_SECRET).trim();
  const configuredSecret = text(process.env.AUTH_SECRET).trim();
  const developmentSecret = process.env.NODE_ENV === 'production' ? '' : randomBytes(32).toString('base64url');
  const signingSecret = configuredSecret || developmentSecret;
  const administrators = new Set(
    text(process.env.ADMIN_EMAILS).split(',').map(normalizeEmail).filter(Boolean)
  );
  const allowedDomains = new Set(text(process.env.GOOGLE_ALLOWED_DOMAINS).split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
  const devEmail = process.env.NODE_ENV === 'production' ? '' : normalizeEmail(process.env.DEV_AUTH_EMAIL);
  const accessStore = createAccessStore({ spreadsheetId, sheetName: accessSheet, dataDir });

  function isConfigured() {
    return Boolean((clientId && clientSecret && configuredSecret) || devEmail);
  }

  function sign(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', signingSecret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  function verify(token) {
    const [encoded, signature] = text(token).split('.');
    if (!encoded || !signature || !signingSecret) return null;
    const expected = createHmac('sha256', signingSecret).update(encoded).digest();
    let supplied;
    try { supplied = Buffer.from(signature, 'base64url'); }
    catch { return null; }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch { return null; }
  }

  function sessionCookie(identity, request) {
    const now = Math.floor(Date.now() / 1000);
    return cookie(SESSION_COOKIE, sign({ email: normalizeEmail(identity.email), name: text(identity.name).trim(), iat: now, exp: now + SESSION_SECONDS }), request, { maxAge: SESSION_SECONDS });
  }

  async function accessFor(email) {
    const normalized = normalizeEmail(email);
    if (administrators.has(normalized)) return { allowed: true, canEdit: true, role: 'admin', status: 'approved', isAdmin: true };
    const record = await accessStore.findByEmail(normalized);
    const status = text(record?.Status || 'not_requested').toLowerCase();
    const role = text(record?.Role || 'viewer').toLowerCase() === 'editor' ? 'editor' : 'viewer';
    return { allowed: status === 'approved', canEdit: status === 'approved' && role === 'editor', role, status, isAdmin: false };
  }

  async function getSession(request) {
    const developmentIdentity = devEmail ? { email: devEmail, name: 'Local administrator' } : null;
    const identity = developmentIdentity || verify(parseCookies(request)[SESSION_COOKIE]);
    if (!identity?.email) return { configured: isConfigured(), authenticated: false, access: { allowed: false, canEdit: false, role: 'viewer', status: 'signed_out', isAdmin: false } };
    return { configured: isConfigured(), authenticated: true, email: normalizeEmail(identity.email), name: text(identity.name), access: await accessFor(identity.email) };
  }

  function oauthClient(request) {
    return new google.auth.OAuth2(clientId, clientSecret, `${requestBaseUrl(request)}/auth/google/callback`);
  }

  return {
    databaseFile: accessStore.databaseFile,
    isConfigured,
    async initialize() { await accessStore.initialize(); },
    getSession,
    async beginGoogle(request, returnTo) {
      if (devEmail) return { redirect: safeReturnTo(returnTo), cookies: [sessionCookie({ email: devEmail, name: 'Local administrator' }, request)] };
      if (!isConfigured()) throw httpError('Google 登录尚未配置，请联系管理员。', 503);
      const nonce = randomBytes(24).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const state = sign({ nonce, returnTo: safeReturnTo(returnTo), exp: now + STATE_SECONDS });
      const redirect = oauthClient(request).generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        state: nonce
      });
      return { redirect, cookies: [cookie(STATE_COOKIE, state, request, { maxAge: STATE_SECONDS, path: '/auth/google/callback' })] };
    },
    async completeGoogle(request, query) {
      const state = verify(parseCookies(request)[STATE_COOKIE]);
      if (!state || !query.state || state.nonce !== query.state) throw httpError('登录状态已过期，请重新开始登录。', 400);
      if (query.error) throw httpError('Google 登录已取消或失败。', 401);
      if (!query.code) throw httpError('Google 登录未返回授权码。', 400);
      const client = oauthClient(request);
      const { tokens } = await client.getToken(query.code);
      client.setCredentials(tokens);
      const profile = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
      const email = normalizeEmail(profile.data.email);
      if (!email || profile.data.verified_email === false) throw httpError('Google 账号邮箱未通过验证。', 403);
      const domain = email.split('@')[1] || '';
      if (allowedDomains.size && !allowedDomains.has(domain)) throw httpError('这个 Google 账号不属于允许的组织域。', 403);
      const session = await accessFor(email);
      const destination = session.allowed ? state.returnTo : `/login.html?state=${session.status === 'rejected' ? 'rejected' : 'request'}&returnTo=${encodeURIComponent(state.returnTo)}`;
      return {
        redirect: destination,
        cookies: [
          sessionCookie({ email, name: profile.data.name || email.split('@')[0] }, request),
          cookie(STATE_COOKIE, '', request, { maxAge: 0, path: '/auth/google/callback' })
        ]
      };
    },
    signOut(request) { return cookie(SESSION_COOKIE, '', request, { maxAge: 0 }); },
    async requestAccess(request, input) {
      const session = await getSession(request);
      if (!session.authenticated) throw httpError('请先使用 Google 账号登录。', 401);
      const reason = text(input.reason).trim();
      if (reason.length < 4) throw httpError('请简要说明需要访问的原因。', 400);
      if (reason.length > 500 || text(input.department).length > 100) throw httpError('申请内容过长。', 400);
      const record = await accessStore.request({ email: session.email, name: session.name }, input);
      return { ok: true, status: record.Status, email: record.Email, updatedAt: record.UpdatedAt };
    },
    async listRequests(request) {
      const session = await getSession(request);
      if (!session.access.isAdmin) throw httpError('只有管理员可以查看访问申请。', session.authenticated ? 403 : 401);
      return { currentUser: { email: session.email, name: session.name }, requests: await accessStore.list() };
    },
    async decide(request, email, input) {
      const session = await getSession(request);
      if (!session.access.isAdmin) throw httpError('只有管理员可以审批访问申请。', session.authenticated ? 403 : 401);
      const record = await accessStore.decide(email, { ...input, reviewer: session.email });
      return { ok: true, request: record };
    }
  };
}
