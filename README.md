# University Knowledge Studio

一个面向大学生的知识管理与创作系统。核心目标是减少“虚度光阴后的遗憾”：帮助学生补足经典阅读、知识结构、外语语料和写作积淀，并把阅读、思考、写作、发布连接成一个持续反馈的闭环。

## Problem

大学生常见的学习遗憾集中在四个方面：

- 读经典书籍不足，缺少长期精神与思想资源。
- 缺乏完整知识结构，阅读、课程与个人兴趣难以组织成体系。
- 外语能力欠缺，真实语料积累不足，学习难以进入输出阶段。
- 写作积淀不足，缺少从问题意识到成稿发布的完整训练。

## Product Loop

1. Bookshelf: 收纳中英文经典书籍、课程材料和外语语料。
2. Reader: 左侧阅读文本，右侧 Canvas，可手绘结构图或调用 AI 预生成结构图。
3. Canvas Library: 汇总所有结构图，形成可检索、可复用的知识结构文件夹。
4. Writing Studio: 点击结构图进入富文本写作编辑器，系统主动出题、追问、互动，帮助用户形成问题意识。
5. Publish: 文稿确认后支持发布、分享、转译，并可一键生成英文或西班牙语绘本、TTS 音频等衍生作品。

## Initial Modules

- Bookshelf: 经典书籍与双语资源管理。
- Reader: 文本阅读、局部标注、生词捕捉。
- Canvas: 知识结构图、AI 预生成结构、结构图文件夹。
- Writing Studio: 富文本写作、主动出题、互动追问、文稿确认。
- AI Assistant: 摘要、写作建议、自动出题、结构图生成、转译与绘本生成。
- Publishing: 作品发布、分享、转译、TTS 和社交反馈。

## Repo Layout

- `CONTEXT.md`: 项目领域语言和长期上下文。
- `docs/prd.md`: 初始产品需求。
- `docs/architecture.md`: 系统架构草案。
- `docs/user-flows.md`: 核心用户路径。
- `docs/feature-specs/`: 模块级功能说明。
- `docs/adr/`: 架构决策记录。

## AI Provider

后端默认使用 DeepSeek OpenAI-compatible API。真实密钥只放在 `apps/api/.env`：

```bash
AI_API_KEY=你的 DeepSeek API Key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
```

如果需要更强推理能力，可以把 `AI_MODEL` 改成 `deepseek-v4-pro`。

## Vercel Deploy

Vercel 项目的 Root Directory 应保持为仓库根目录，不要选 `apps/api` 或 `apps/web`。根目录的 `vercel.json` 会负责：

- 构建前端：`npm run build -w apps/web`
- 发布目录：`apps/web/dist`
- 把非 `/api` 路径回退到 `index.html`
- 把 `/api/*` 交给根目录 `api/[...path].js` 中的 Serverless Function

需要在 Vercel Project Settings -> Environment Variables 配置：

```bash
AI_API_KEY=你的 DeepSeek API Key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
```

注意：Vercel Serverless 文件系统不是长期存储。生产环境如果要长期保存上传的电子书和解析结果，需要接入 Vercel Blob、数据库或对象存储。

## GitNexus

GitNexus CLI 已在本机可用。后续可在本项目目录运行：

```bash
gitnexus analyze
gitnexus status
```

## Next Step

下一步建议先做一个可运行原型：Reader 左右分栏、Canvas 结构图文件夹、Writing Studio 的主动出题体验。这个原型不必先接真实书库，先验证“读完以后能不能被引导写出来”。
