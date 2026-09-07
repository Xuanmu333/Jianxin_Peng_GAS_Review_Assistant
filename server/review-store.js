import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_MODEL_VERSION = 'v0.1';

export function createReviewStore({ dataDir, backupDir, maxBackups = 10 }) {
  const databaseFile = path.join(dataDir, 'reviews.json');
  let writeQueue = Promise.resolve();

  async function ensureDirectories() {
    await Promise.all([
      mkdir(dataDir, { recursive: true }),
      mkdir(backupDir, { recursive: true })
    ]);
  }

  function emptyDatabase() {
    return {
      schemaVersion: SCHEMA_VERSION,
      modelVersion: DEFAULT_MODEL_VERSION,
      updatedAt: new Date().toISOString(),
      reviews: {}
    };
  }

  async function readDatabase() {
    await ensureDirectories();
    try {
      const raw = await readFile(databaseFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('根节点必须是对象。');
      if (!parsed.reviews || typeof parsed.reviews !== 'object' || Array.isArray(parsed.reviews)) parsed.reviews = {};
      parsed.schemaVersion = Number(parsed.schemaVersion || SCHEMA_VERSION);
      parsed.modelVersion = String(parsed.modelVersion || DEFAULT_MODEL_VERSION);
      return parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`本地数据文件无法读取：${error.message}`);
      }
      const database = emptyDatabase();
      await writeFile(databaseFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
      return database;
    }
  }

  async function pruneBackups() {
    const entries = await readdir(backupDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && /^reviews-.*\.json$/.test(entry.name));
    const details = await Promise.all(files.map(async entry => ({
      name: entry.name,
      modifiedAt: (await stat(path.join(backupDir, entry.name))).mtimeMs
    })));
    const stale = details.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(maxBackups);
    await Promise.all(stale.map(file => unlink(path.join(backupDir, file.name))));
  }

  async function writeDatabase(database) {
    await ensureDirectories();
    database.schemaVersion = SCHEMA_VERSION;
    database.updatedAt = new Date().toISOString();
    const timestamp = database.updatedAt.replace(/[:.]/g, '-');
    try {
      await copyFile(databaseFile, path.join(backupDir, `reviews-${timestamp}.json`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const temporaryFile = path.join(dataDir, `reviews.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporaryFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, databaseFile);
    await pruneBackups();
  }

  function queueWrite(operation) {
    writeQueue = writeQueue.catch(() => undefined).then(operation);
    return writeQueue;
  }

  function summarize(review) {
    return {
      reviewId: String(review.reviewId || ''),
      projectId: String(review.projectId || ''),
      projectName: String(review.project || ''),
      reviewDate: String(review.date || ''),
      status: String(review.reviewStatus || 'in_progress'),
      modelVersion: String(review.modelVersion || DEFAULT_MODEL_VERSION),
      updatedAt: String(review.updatedAt || review.createdAt || '')
    };
  }

  return {
    databaseFile,

    async initialize() {
      await readDatabase();
    },

    async getBootstrap() {
      const database = await readDatabase();
      return {
        appTitle: '问题管理系统',
        modelVersion: database.modelVersion,
        storage: 'local-json',
        dataFile: databaseFile,
        reviews: Object.values(database.reviews)
          .map(summarize)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      };
    },

    async loadReview(reviewId) {
      const database = await readDatabase();
      const review = database.reviews[String(reviewId || '')];
      if (!review) throw Object.assign(new Error(`找不到项目记录：${reviewId}`), { statusCode: 404 });
      return structuredClone(review);
    },

    async saveReview(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw Object.assign(new Error('Review 数据格式无效。'), { statusCode: 400 });
      }
      const reviewId = String(payload.reviewId || '').trim();
      if (!reviewId) throw Object.assign(new Error('reviewId 不能为空。'), { statusCode: 400 });
      return queueWrite(async () => {
        const database = await readDatabase();
        const now = new Date().toISOString();
        const stored = structuredClone(payload);
        stored.reviewId = reviewId;
        stored.createdAt = String(stored.createdAt || now);
        stored.updatedAt = now;
        database.modelVersion = String(stored.modelVersion || database.modelVersion || DEFAULT_MODEL_VERSION);
        database.reviews[reviewId] = stored;
        await writeDatabase(database);
        return {
          ok: true,
          reviewId,
          updatedAt: now,
          issueCount: Array.isArray(stored.issues) ? stored.issues.length : 0,
          historyCount: Array.isArray(stored.issueHistory) ? stored.issueHistory.length : 0
        };
      });
    }
  };
}
