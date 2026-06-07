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
AI_MODEL=deepseek-v4-pro
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
AI_MODEL=deepseek-v4-pro
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
SUPABASE_RESOURCES_TABLE=knowledge_resources
SUPABASE_STORAGE_BUCKET=knowledge-resource-files
```

Supabase 初始化：

1. 在 Supabase 项目的 SQL Editor 运行 `supabase/schema.sql`。
2. 后端会把原始上传文件保存到 Supabase Storage bucket：`knowledge-resource-files`。
3. 后端会把解析后的书籍 JSON 保存到 `public.knowledge_resources.resource`。
4. `SUPABASE_SERVICE_ROLE_KEY` 只能放在 `apps/api/.env` 或 Vercel 后端环境变量里，不能放进前端。

如果没有配置 Supabase 环境变量，本地开发会继续 fallback 到 `apps/api/data/`。

## GitNexus

GitNexus CLI 已在本机可用。后续可在本项目目录运行：

```bash
gitnexus analyze
gitnexus status
```

## Next Step

