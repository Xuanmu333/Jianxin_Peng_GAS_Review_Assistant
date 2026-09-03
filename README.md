# 问题管理系统（本地网页版）

这是一个在本机运行的跨平台 Web 应用。项目、Review 问题库、问题队列和保存记录不依赖 Google Apps Script 或 Google Sheet，数据保存在本地 JSON 文件中。

## 运行环境

- macOS 或 Windows。
- Node.js 18 或更高版本。
- Chrome、Edge、Safari 等现代浏览器。

首次使用时需要在项目目录运行一次 `npm install`，用于安装本地 GSAP 动效库。

## 启动

### macOS

首次使用时，在终端运行一次：

```bash
chmod +x start.command
```

之后双击 `start.command`，或在项目目录运行：

```bash
npm start
```

### Windows

双击 `start.bat`，或在项目目录运行：

```bat
npm start
```

启动后会自动打开：

```text
http://127.0.0.1:4173/
```

不要直接双击 `public/index.html`。页面必须通过本地服务打开，才能读取和保存项目。

## 本地数据

主数据文件：

```text
data/reviews.json
```

每次保存前，程序会把上一版数据复制到：

```text
backups/
```

默认保留最近 10 份备份。不要在程序运行时手工编辑 `reviews.json`。

macOS 和 Windows 使用相同的数据格式，可以在应用关闭后复制 `data/reviews.json` 到另一台电脑。两台电脑的本地数据不会自动同步。

## 项目结构

```text
public/
  index.html          标准网页结构
  styles.css          页面样式
  model-data.js       逻辑问题链
  app.js              页面交互和本地 API 调用
server/
  server.js           本地 Web 服务和 API
  review-store.js     JSON 数据读取、保存和备份
  ai-service.js       AI 扩展问题代理
  load-env.js         可选的本地环境变量读取
data/
  reviews.json        本地项目数据
backups/              自动备份目录
start.command         macOS 启动入口
start.bat             Windows 启动入口
```

## AI 设置

可以继续在页面右上角的“AI 设置”中填写 HTTPS Endpoint、Model 和 API Key：

AI 设置用于基于现有问题链和现场回答扩展追问。

- Endpoint 和 Model 保存在当前浏览器。
- API Key 只保存在当前浏览器标签页会话。
- AI 请求由本地 Node 服务转发。
- API Key 不会写入 `data/reviews.json`。

如果希望使用本机固定配置，可以复制 `.env.example` 为 `.env`，然后填写：

```text
AI_ENDPOINT=https://api.example.com/v1/chat/completions
AI_MODEL=YOUR_MODEL_NAME
AI_API_KEY=YOUR_API_KEY_HERE
```

`.env` 已被 `.gitignore` 排除，不要把真实密钥发送给他人或提交到代码仓库。

## 本地 API

| API | 用途 |
|---|---|
| `GET /api/health` | 检查本地服务状态 |
| `GET /api/bootstrap` | 获取模型版本和项目列表 |
| `GET /api/reviews/:reviewId` | 加载项目 |
| `PUT /api/reviews/:reviewId` | 保存项目 |
| `DELETE /api/reviews/:reviewId` | 删除项目记录 |
| `POST /api/ai/questions` | 生成 AI 扩展问题 |

## 数据迁移说明

旧 Google Sheet 数据不会自动出现在本地应用中。旧数据需要先导出为完整 Review JSON，再导入 `data/reviews.json`。迁移完成并核对项目、问题及保存版本数量后，才能停止使用旧 Apps Script 版本。

## 常见问题

### 页面提示“本地服务未连接”

不要直接打开 HTML 文件。请运行 `start.command`、`start.bat` 或 `npm start`。

### 4173 端口被占用

先关闭之前打开的 Review Assistant 终端窗口，再重新启动。也可以在 `.env` 中设置其他端口：

```text
PORT=4174
```

### 如何备份

关闭应用后，复制整个 `data` 和 `backups` 文件夹即可。
