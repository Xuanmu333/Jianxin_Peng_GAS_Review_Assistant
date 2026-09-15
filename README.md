# Issues Management

这是一个面向项目 Review 的提问与记录工作台。页面从 Google Sheets 的 `Questions` 读取提问库，把项目、问题、回答、历史版本和 AI 报告写入同一份表格的 `Issues`。

目标 Google Sheet：

```text
https://docs.google.com/spreadsheets/d/1py3sy7Cf2HCTxdhrRhFGoYzrnLRomOrNrTJU7KrGKUE/
```

## 页面结构

- `登录`：使用 Google OAuth 登录，并验证账号是否已获得访问权限。
- `授权审批`：管理员查看访问申请，批准为只读或可编辑，也可以拒绝或撤销授权。
- `提问工作台`：选择项目问题，从提问库中找到要问的话，并记录团队回答。
- `项目问题与报告`：按项目、分类和状态筛选问题，查看或生成问题报告。
- `AI 深入追问`：只有在已有回答后才可使用；服务会把本问题的全部已保存回答与已问内容一起送给 AI，避免重复预设问题。
- `Questions` 不提供独立管理页面，只作为工作台的数据源。
- 默认浅色主题，右上角可切换主体色为 `#1a1a1a` 的深色主题。

## Google Sheets 数据模型

### AccessRequests

登录后的访问申请与管理员审批结果保存在 `AccessRequests`。`ADMIN_EMAILS` 中的账号拥有管理员权限，不依赖审批表；普通账号只有在状态为 `approved` 时才能进入工作台。管理员可以授予：

- `viewer`：可查看项目、问题和报告。
- `editor`：可查看并新增、修改、生成 AI 内容。

撤销授权后，服务端会在下一次 API 请求时重新检查权限，已打开的页面也不能继续读取或写入数据。

### Questions

每行是一版提问，关键字段是：

```text
QuestionID | Version | CategoryCode | CategoryName | Rule | Confidence |
QuestionText | Status | Source | ParentQuestionID | UpdatedAt
```

页面只读取每个 `QuestionID` 中版本最高且状态为 `active` 的提问。

当提问文字变化时，不修改旧版本，而是新增版本。例如 `A1@1` 更新为 `A1@2`。系统会在 `Issues` 新增对应的问题列，历史回答仍保留在旧列，不会因列名变化而错位。

### Issues

每一行是一条项目元数据、当前问题或历史快照：

- `RecordType=review`：项目元数据。
- `RecordType=current`：当前问题及全部回答。
- `RecordType=history`：每次保存回答、AI 深入追问或更新报告时的历史快照。
- 固定字段保存项目、问题、状态、报告和版本信息。
- 每版提问对应一列，列名格式为 `Q:A1@1 | 提问文字`。
- 多人同时使用时，服务会按提问版本和回答更新时间合并；回答不同提问不会互相覆盖，同一提问以较新的保存为准。

## 本地启动

需要 Node.js 18 或更高版本、能够访问目标 Sheet 的 Google Cloud 凭据，以及 Google OAuth Web 客户端。

```bash
npm install
cp .env.example .env
npm start
```

本地凭据使用 Application Default Credentials。可以执行 `gcloud auth application-default login`，或通过未提交到仓库的 `.env` 配置凭据文件。不要把服务账号密钥提交到 Git。

本地 OAuth 回调地址需要添加到 Google Cloud Console：

```text
http://127.0.0.1:4173/auth/google/callback
```

未设置 `REVIEW_SPREADSHEET_ID` 时，应用保留本地 JSON 存储作为离线回退；提问库使用 `public/model-data.js` 中的内置数据。仅在非生产环境可设置 `DEV_AUTH_EMAIL`，用于不经过 Google OAuth 的本地界面测试。

启动后访问：

```text
http://127.0.0.1:4173/
```

## 从会议提炼流程同步新问题

Cloud Run 配置 `QUESTION_SYNC_TOKEN` 后，训练或会议提炼流程可以调用：

```http
POST /api/questions/sync
Authorization: Bearer YOUR_RANDOM_SYNC_TOKEN_HERE
Content-Type: application/json

{
  "questions": [
    {
      "questionId": "A1",
      "text": "更新后的问题文字",
      "categoryCode": "A",
      "categoryName": "对象与状态",
      "source": "2026-09 项目会议"
    }
  ]
}
```

同步规则：完全相同的文字会跳过；相同 `QuestionID` 的新文字自动增加版本；没有 `QuestionID` 时生成新 ID。`QUESTION_SYNC_TOKEN` 必须存放在 Cloud Run Secret Manager，不要写入代码或表格。

## Cloud Run

项目已包含 `Dockerfile` 和私有部署脚本：

```bash
chmod +x scripts/deploy-cloud-run.sh
./scripts/deploy-cloud-run.sh
```

脚本默认使用：

```text
Project: pdc-digital-system
Region: asia-east1
Service: issues-management
Service account: pdc-digital-system@pdc-digital-system.iam.gserviceaccount.com
```

Cloud Run 保持公开入口，让 Google OAuth 回调能够到达应用；Review 页面与数据 API 由应用级授权保护。正式域名还需要在 OAuth Web 客户端中添加：

```text
https://YOUR_CLOUD_RUN_URL/auth/google/callback
```

生产环境必须配置 `AUTH_URL`、`AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `ADMIN_EMAILS`。密钥应使用 Secret Manager，不要提交到仓库。

## API

| API | 用途 |
|---|---|
| `GET /api/health` | 检查服务和存储模式 |
| `GET /api/auth/session` | 获取当前登录与授权状态 |
| `POST /api/access-requests` | 当前 Google 账号提交访问申请 |
| `GET /api/admin/access-requests` | 管理员读取访问申请 |
| `PATCH /api/admin/access-requests/:email` | 管理员批准、拒绝或撤销授权 |
| `GET /api/bootstrap` | 获取项目列表和当前提问库 |
| `GET /api/reviews/:reviewId` | 加载一个项目 |
| `PUT /api/reviews/:reviewId` | 保存项目、问题和回答 |
| `POST /api/ai/questions` | 基于全部已保存回答生成去重追问 |
| `POST /api/ai/report` | 基于已保存回答生成问题报告 |
| `POST /api/questions/sync` | 受令牌保护的提问库同步入口 |

## 检查

```bash
npm run check
```
