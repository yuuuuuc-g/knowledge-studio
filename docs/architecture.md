# Architecture Draft

## System Shape

系统分为六个核心域：

- Content Domain: 书籍、章节、文本片段、双语语料。
- Reading Domain: 阅读进度、标注、生词、摘要。
- Canvas Domain: 结构图、节点、边、布局、来源链接。
- Writing Domain: 富文本文稿、题目、追问、草稿版本。
- AI Domain: 摘要、结构图生成、出题、写作建议、转译、绘本生成。
- Publishing Domain: 发布、分享、衍生作品、社交反馈。

## Suggested Data Model

### Book

- id
- title
- author
- language
- sourceType
- tags

### TextSegment

- id
- bookId
- chapterId
- range
- content
- language

### Annotation

- id
- textSegmentId
- userId
- note
- highlightRange
- createdAt

### CanvasMap

- id
- title
- sourceBookId
- sourceSegmentIds
- nodes
- edges
- layout
- generatedBy
- createdAt

### WritingProject

- id
- canvasMapId
- title
- prompts
- editorContent
- status
- confirmedAt

### DerivativeWork

- id
- writingProjectId
- type
- language
- assetUrl
- status

## AI Workflows

### Structure Generation

Input: selected TextSegment list.

Output: CanvasMap draft with nodes, relations, key claims and open questions.

### Question Generation

Input: CanvasMap and current draft.

Output: questions grouped by intent:

- comprehension
- comparison
- critique
- transfer
- language practice

### Writing Assistance

Input: draft, selected Canvas nodes and target format.

Output: outline suggestions, missing evidence, possible counterarguments and style notes.

### Derivative Generation

Input: confirmed manuscript.

Output: translated picture book script, image prompts, TTS script and audio tasks.

## Integration Candidates

- Rich text editor: TipTap or Lexical.
- Canvas: React Flow, Excalidraw integration, or custom whiteboard.
- TTS: OpenAI TTS, Azure Speech, or local model integration.
- Dictionary: ECDICT, Youdao API, or browser extension bridge.
- Storage: Postgres plus object storage for assets.

## First Prototype

Build one vertical slice:

Reader text -> AI structure draft -> Canvas Library -> Writing Studio prompt -> confirmed draft -> English picture book outline.
