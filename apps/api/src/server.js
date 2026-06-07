import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const dataDir = process.env.VERCEL ? path.join(os.tmpdir(), "knowledge-studio") : path.resolve(__dirname, "../data");
const uploadsDir = path.join(dataDir, "uploads");
const resourcesFile = path.join(dataDir, "resources.json");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabaseResourcesTable = process.env.SUPABASE_RESOURCES_TABLE || "knowledge_resources";
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || "knowledge-resource-files";
const supabaseEnabled = Boolean(supabaseUrl && supabaseServiceKey);

const app = express();
const port = Number(process.env.PORT || 8787);
const webOrigin = process.env.WEB_ORIGIN || "http://127.0.0.1:5173";
const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const aiBaseUrl = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com";
const aiModel = process.env.AI_MODEL || process.env.OPENAI_MODEL || "deepseek-v4-flash";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(cors({ origin: webOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(aiKey),
    model: aiModel,
    storage: supabaseEnabled ? "supabase" : "local"
  });
});

app.get("/api/resources", async (_req, res, next) => {
  try {
    res.json({ resources: await readStoredResources() });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/resources/:id", async (req, res, next) => {
  try {
    const updated = await updateStoredResource(req.params.id, req.body || {});
    if (!updated) {
      res.status(404).json({ error: "没有找到这个资源。" });
      return;
    }
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/resources/:id", async (req, res, next) => {
  try {
    const deleted = await deleteStoredResource(req.params.id);
    res.json({ ok: true, deleted });
  } catch (error) {
    next(error);
  }
});

app.post("/api/resources/import", upload.single("resource"), async (req, res, next) => {
  try {
    const file = req.file;
    const title = req.body.title?.trim() || file?.originalname?.replace(/\.[^.]+$/, "") || "未命名资源";
    const author = req.body.author?.trim() || "未注明作者";
    const language = req.body.language || "中文";
    const supplementalText = req.body.supplementalText?.trim() || "";

    if (!file && !supplementalText) {
      res.status(400).json({ error: "请上传文件，或填写补充正文。" });
      return;
    }

    const imported = file ? await parseResourceFile(file, supplementalText) : parseManualResource(supplementalText);
    const book = {
      id: `book-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      title,
      author,
      language,
      type: imported.resourceType,
      sourceFormat: imported.sourceFormat,
      fileName: file?.originalname || "",
      fileSize: file?.size || 0,
      importStatus: imported.status,
      importNote: imported.note,
      tags: [imported.resourceType, language, imported.sourceFormat].filter(Boolean),
      paragraphs: imported.paragraphs
    };
    const storedBook = await persistResource(book, file);
    res.json(storedBook);
  } catch (error) {
    next(error);
  }
});

app.post("/api/translate", async (req, res, next) => {
  try {
    const { text = "", target = "English" } = req.body || {};
    const fallback = fallbackTranslation(text, target);
    if (!String(text).trim() || !aiKey) {
      res.json({ output: String(text).trim() ? fallback : "", fallback: true });
      return;
    }
    const output = await callOpenAiText([
      {
        role: "system",
        content:
          "You are a precise translator for a knowledge studio. Preserve paragraph breaks, reasoning structure, and academic tone. Return only the translated text."
      },
      { role: "user", content: `Translate the following text into ${target}:\n\n${text}` }
    ]);
    res.json({ output: output || fallback, fallback: !output });
  } catch (error) {
    next(error);
  }
});

app.post("/api/structure", async (req, res, next) => {
  try {
    const { title = "结构图", paragraphs = [] } = req.body || {};
    const source = Array.isArray(paragraphs) ? paragraphs.join("\n\n").slice(0, 9000) : "";
    const fallback = fallbackStructure(title, paragraphs);
    if (!aiKey || !source.trim()) {
      res.json({ ...fallback, fallback: true });
      return;
    }
    const raw = await callOpenAiText(
      [
        {
          role: "system",
          content:
            "Generate a whiteboard-ready knowledge map. Return strict JSON only: {\"title\": string, \"nodes\": [{\"text\": string, \"kind\": \"claim\"|\"concept\"|\"question\"|\"evidence\", \"x\": number, \"y\": number}], \"edges\": [[number, number]]}. Use 4-8 concise nodes. Coordinates are Excalidraw canvas coordinates."
        },
        { role: "user", content: `Resource title: ${title}\n\nSource text:\n${source}` }
      ],
      { json: true }
    );
    res.json(normalizeStructure(parseJson(raw) || fallback, fallback));
  } catch (error) {
    next(error);
  }
});

app.post("/api/questions", async (req, res, next) => {
  try {
    const { mapTitle = "结构图", nodes = [], draft = "" } = req.body || {};
    const fallback = fallbackQuestions(mapTitle, nodes);
    if (!aiKey) {
      res.json({ questions: fallback, fallback: true });
      return;
    }
    const raw = await callOpenAiText(
      [
        {
          role: "system",
          content:
            "你是大学写作问题引擎。必须只返回严格 JSON：{\"questions\": string[]}。所有问题必须使用简体中文，不要输出英文或双语题目。问题要主动、具体、有辨析度，推动学生进行比较、举证、批判和迁移。"
        },
        {
          role: "user",
          content: `结构图标题：${mapTitle}\n结构节点：${JSON.stringify(nodes).slice(0, 5000)}\n当前草稿：${String(draft).slice(0, 3000)}\n请生成 4 到 6 个简体中文写作问题。`
        }
      ],
      { json: true }
    );
    const parsed = parseJson(raw);
    res.json({
      questions: Array.isArray(parsed?.questions) && parsed.questions.length ? parsed.questions.slice(0, 6) : fallback,
      fallback: !parsed
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error("[api-error]", error);
  res.status(500).json({ error: error.message || "Internal server error" });
});

if (!process.env.VERCEL) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`Knowledge Studio API running at http://127.0.0.1:${port}`);
    if (!aiKey) console.log("AI_API_KEY is empty. AI endpoints will return local fallbacks.");
  });
}

export default app;

async function callOpenAiText(messages, options = {}) {
  const response = await fetch(`${aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
    body: JSON.stringify({
      model: aiModel,
      messages,
      temperature: 0.3,
      ...(options.json ? { response_format: { type: "json_object" } } : {})
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function persistResource(book, file) {
  if (supabaseEnabled) return persistResourceToSupabase(book, file);
  return persistResourceToLocal(book, file);
}

async function persistResourceToLocal(book, file) {
  await fs.mkdir(uploadsDir, { recursive: true });
  let storedFile = null;

  if (file) {
    const extension = getFileExtension(file.originalname);
    const fileName = `${book.id}${extension ? `.${extension}` : ""}`;
    const filePath = path.join(uploadsDir, fileName);
    await fs.writeFile(filePath, file.buffer);
    storedFile = {
      originalName: file.originalname,
      storedName: fileName,
      relativePath: path.relative(dataDir, filePath),
      size: file.size
    };
  }

  const storedBook = {
    ...book,
    storage: {
      persistedAt: new Date().toISOString(),
      parsedResourcePath: "resources.json",
      file: storedFile
    }
  };
  const current = await readStoredResources();
  await writeStoredResources([storedBook, ...current.filter((item) => item.id !== storedBook.id)]);
  return storedBook;
}

async function deleteStoredResource(id) {
  if (supabaseEnabled) return deleteStoredResourceFromSupabase(id);
  return deleteStoredResourceFromLocal(id);
}

async function updateStoredResource(id, changes) {
  if (supabaseEnabled) return updateStoredResourceInSupabase(id, changes);
  return updateStoredResourceInLocal(id, changes);
}

async function deleteStoredResourceFromLocal(id) {
  const current = await readStoredResources();
  const target = current.find((resource) => resource.id === id);
  if (!target) return false;

  const relativePath = target.storage?.file?.relativePath;
  if (relativePath) {
    const filePath = path.resolve(dataDir, relativePath);
    if (filePath.startsWith(`${dataDir}${path.sep}`)) {
      await fs.rm(filePath, { force: true });
    }
  }

  await writeStoredResources(current.filter((resource) => resource.id !== id));
  return true;
}

async function updateStoredResourceInLocal(id, changes) {
  const current = await readStoredResources();
  const target = current.find((resource) => resource.id === id);
  if (!target) return null;

  const updated = applyResourceChanges(target, changes);
  await writeStoredResources(current.map((resource) => (resource.id === id ? updated : resource)));
  return updated;
}

async function readStoredResources() {
  if (supabaseEnabled) return readStoredResourcesFromSupabase();
  return readStoredResourcesFromLocal();
}

async function readStoredResourcesFromLocal() {
  try {
    const raw = await fs.readFile(resourcesFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeStoredResources(resources) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(resourcesFile, JSON.stringify(resources, null, 2));
}

async function persistResourceToSupabase(book, file) {
  let storedFile = null;

  if (file) {
    const extension = getFileExtension(file.originalname);
    const storedName = `${book.id}${extension ? `.${extension}` : ""}`;
    const storagePath = `resources/${book.id}/${storedName}`;
    await uploadSupabaseObject(storagePath, file);
    storedFile = {
      originalName: file.originalname,
      storedName,
      relativePath: storagePath,
      bucket: supabaseStorageBucket,
      size: file.size
    };
  }

  const storedBook = {
    ...book,
    storage: {
      provider: "supabase",
      persistedAt: new Date().toISOString(),
      parsedResourcePath: `${supabaseResourcesTable}.resource`,
      file: storedFile
    }
  };

  await supabaseRestRequest(`/${encodeURIComponent(supabaseResourcesTable)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: storedBook.id,
      resource: storedBook,
      storage_path: storedFile?.relativePath || null
    })
  });

  return storedBook;
}

async function readStoredResourcesFromSupabase() {
  const rows = await supabaseRestRequest(
    `/${encodeURIComponent(supabaseResourcesTable)}?select=resource&order=created_at.desc`
  );
  return Array.isArray(rows) ? rows.map((row) => row.resource).filter(Boolean) : [];
}

async function deleteStoredResourceFromSupabase(id) {
  const rows = await supabaseRestRequest(
    `/${encodeURIComponent(supabaseResourcesTable)}?select=resource,storage_path&id=eq.${encodeURIComponent(id)}`
  );
  const target = Array.isArray(rows) ? rows[0] : null;
  if (!target) return false;

  if (target.storage_path) {
    await deleteSupabaseObject(target.storage_path);
  }

  await supabaseRestRequest(`/${encodeURIComponent(supabaseResourcesTable)}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  return true;
}

async function updateStoredResourceInSupabase(id, changes) {
  const rows = await supabaseRestRequest(
    `/${encodeURIComponent(supabaseResourcesTable)}?select=resource,storage_path&id=eq.${encodeURIComponent(id)}`
  );
  const target = Array.isArray(rows) ? rows[0] : null;
  if (!target?.resource) return null;

  const updated = applyResourceChanges(target.resource, changes);
  await supabaseRestRequest(`/${encodeURIComponent(supabaseResourcesTable)}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      resource: updated,
      storage_path: target.storage_path || updated.storage?.file?.relativePath || null
    })
  });
  return updated;
}

function applyResourceChanges(resource, changes) {
  const title = cleanText(changes.title);
  const author = cleanText(changes.author);
  const language = cleanText(changes.language);
  const tags = normalizeTags(changes.tags);

  return {
    ...resource,
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
    ...(tags ? { tags } : {}),
    storage: {
      ...(resource.storage || {}),
      updatedAt: new Date().toISOString()
    }
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTags(value) {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value : String(value).split(/[,，]/);
  const tags = raw.map((tag) => String(tag).trim()).filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 12);
}

async function uploadSupabaseObject(storagePath, file) {
  await supabaseStorageRequest(`/object/${encodeURIComponent(supabaseStorageBucket)}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.mimetype || "application/octet-stream",
      "x-upsert": "true"
    },
    body: file.buffer
  });
}

async function deleteSupabaseObject(storagePath) {
  await supabaseStorageRequest(`/object/${encodeURIComponent(supabaseStorageBucket)}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes: [storagePath] })
  });
}

async function supabaseRestRequest(pathname, options = {}) {
  return supabaseRequest(`/rest/v1${pathname}`, options);
}

async function supabaseStorageRequest(pathname, options = {}) {
  return supabaseRequest(`/storage/v1${pathname}`, options);
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      ...(options.body && !(options.body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? parseJson(text) || text : null;
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function encodeStoragePath(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

function fallbackTranslation(text, target) {
  if (target === "Spanish") {
    return `Borrador de traduccion (Espanol):\n\n${text}\n\nTesis central: una pregunta de lectura puede convertirse en un mapa de ideas, y ese mapa puede convertirse en una voz propia.`;
  }
  if (target === "Chinese") {
    return `中文转译草稿：\n\n${text}\n\n核心表达：阅读中的问题可以变成结构图，结构图可以继续发展成有个人声音的文稿。`;
  }
  return `Translation draft (English):\n\n${text}\n\nCore thesis: A reading question can become a structure map, and a structure map can become a draft with a clear voice.`;
}

async function parseResourceFile(file, supplementalText) {
  const extension = getFileExtension(file.originalname);

  if (["txt", "text"].includes(extension)) {
    const rawText = file.buffer.toString("utf8");
    return buildImportedResource("文本", "txt", extractParagraphs(rawText), "文本文件已读取。");
  }

  if (["md", "markdown"].includes(extension)) {
    const rawText = file.buffer.toString("utf8");
    return buildImportedResource("Markdown", "markdown", extractParagraphs(markdownToPlainText(rawText)), "Markdown 已转换为阅读段落。");
  }

  if (["html", "htm"].includes(extension)) {
    const rawText = file.buffer.toString("utf8");
    return buildImportedResource("网页文本", "html", extractParagraphs(htmlToPlainText(rawText)), "HTML 已抽取正文文本。");
  }

  if (extension === "epub") {
    return parseEpubResource(file, supplementalText);
  }

  if (["pdf", "mobi", "azw3"].includes(extension)) {
    const fallbackText =
      supplementalText ||
      `${file.originalname} 已上传。\n\n这个 ${extension.toUpperCase()} 文件已进入资源库。当前接口已保存文件元信息；完整正文抽取会在后续接入专用解析器。`;
    return buildImportedResource(
      "电子书",
      extension,
      extractParagraphs(fallbackText),
      `${extension.toUpperCase()} 已上传，当前先作为待解析资源入库。`,
      "pending-extraction"
    );
  }

  if (supplementalText) {
    return buildImportedResource("个人资源", extension || "file", extractParagraphs(supplementalText), "文件格式暂未解析，已使用补充正文。");
  }

  throw new Error("暂不支持这个文件格式。请上传 TXT、Markdown、HTML、PDF、EPUB、MOBI 或 AZW3。");
}

function parseEpubResource(file, supplementalText) {
  try {
    const chapters = extractEpubChapters(file.buffer);
    const paragraphs = extractParagraphs(chapters.join("\n\n"));
    if (paragraphs.length) {
      return buildImportedResource("电子书", "epub", paragraphs, `EPUB 已解析：读取 ${chapters.length} 个章节。`);
    }
  } catch (error) {
    console.warn("[epub-parse-warning]", error.message);
  }

  if (supplementalText) {
    return buildImportedResource("电子书", "epub", extractParagraphs(supplementalText), "EPUB 自动解析失败，已使用补充正文。");
  }

  throw new Error("EPUB 解析失败。请确认文件未加密，或在上传时填写补充正文。");
}

function extractEpubChapters(buffer) {
  const zip = new AdmZip(buffer);
  const entries = new Map(zip.getEntries().map((entry) => [normalizeZipPath(entry.entryName), entry]));
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true
  });

  const containerEntry = entries.get("META-INF/container.xml");
  if (!containerEntry) throw new Error("EPUB 缺少 META-INF/container.xml。");

  const container = parser.parse(containerEntry.getData().toString("utf8"));
  const rootFile = ensureArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = normalizeZipPath(rootFile?.["full-path"]);
  if (!opfPath || !entries.has(opfPath)) throw new Error("EPUB 缺少 OPF 包文件。");

  const opf = parser.parse(entries.get(opfPath).getData().toString("utf8"));
  const opfDir = path.posix.dirname(opfPath);
  const manifestItems = ensureArray(opf?.package?.manifest?.item);
  const manifest = new Map(manifestItems.map((item) => [item.id, item]));
  const spineItems = ensureArray(opf?.package?.spine?.itemref);

  const chapterTexts = spineItems
    .map((itemRef) => manifest.get(itemRef.idref))
    .filter(Boolean)
    .map((item) => normalizeZipPath(path.posix.join(opfDir, item.href || "")))
    .filter((chapterPath) => entries.has(chapterPath))
    .map((chapterPath) => htmlToPlainText(entries.get(chapterPath).getData().toString("utf8")))
    .map((text) => text.trim())
    .filter(Boolean);

  if (!chapterTexts.length) throw new Error("EPUB spine 中没有找到可读取章节。");
  return chapterTexts;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeZipPath(value = "") {
  return String(value).replace(/^\/+/, "").replace(/\\/g, "/");
}

function parseManualResource(text) {
  return buildImportedResource("个人资源", "manual", extractParagraphs(text), "手动正文已导入。");
}

function buildImportedResource(resourceType, sourceFormat, paragraphs, note, status = "ready") {
  if (!paragraphs.length) {
    throw new Error("没有发现可导入的正文段落。");
  }
  return {
    resourceType,
    sourceFormat,
    paragraphs,
    note,
    status
  };
}

function getFileExtension(fileName = "") {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function markdownToPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\s-*+]+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function htmlToPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(p|div|section|article|main|header|footer|aside|nav|h[1-6]|li|blockquote|pre|tr|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractParagraphs(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=[。！？.!?])\s+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => line.slice(0, 1600));
}

function fallbackStructure(title, paragraphs) {
  const first = paragraphs?.[0] || "中心问题";
  return {
    title: `${title} 结构图`,
    nodes: [
      { text: first.slice(0, 48), kind: "evidence", x: 220, y: 60 },
      { text: "稀缺资源如何分配", kind: "question", x: 180, y: 330 },
      { text: "权力如何分配", kind: "concept", x: 620, y: 230 },
      { text: "财富如何分配", kind: "concept", x: 640, y: 360 },
      { text: "地位如何分配", kind: "concept", x: 620, y: 500 }
    ],
    edges: [
      [1, 2],
      [1, 3],
      [1, 4],
      [0, 1]
    ]
  };
}

function fallbackQuestions(mapTitle, nodes) {
  const first = nodes?.[0]?.text || mapTitle;
  return [
    `这个结构图背后最尖锐的问题是什么？请不要只复述「${first}」。`,
    "哪两个节点之间存在冲突、张力或互相补充？",
    "你能用一个现实例子证明或挑战这张图的核心判断吗？",
    "如果把这张图改写成一句中文中心论点，最短、最有力量的表达是什么？"
  ];
}

function normalizeStructure(value, fallback) {
  const nodes = Array.isArray(value.nodes) ? value.nodes : fallback.nodes;
  const normalizedNodes = nodes.slice(0, 8).map((node, index) => ({
    text: String(node.text || fallback.nodes[index % fallback.nodes.length].text).slice(0, 90),
    kind: ["claim", "concept", "question", "evidence"].includes(node.kind) ? node.kind : "concept",
    x: Number.isFinite(Number(node.x)) ? Number(node.x) : 160 + (index % 3) * 260,
    y: Number.isFinite(Number(node.y)) ? Number(node.y) : 120 + Math.floor(index / 3) * 180
  }));
  const edges = Array.isArray(value.edges) ? value.edges : fallback.edges;
  return {
    title: String(value.title || fallback.title),
    nodes: normalizedNodes,
    edges: edges
      .filter((edge) => Array.isArray(edge) && edge.length >= 2)
      .map(([from, to]) => [Number(from), Number(to)])
      .filter(([from, to]) => from >= 0 && to >= 0 && from < normalizedNodes.length && to < normalizedNodes.length)
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text?.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
