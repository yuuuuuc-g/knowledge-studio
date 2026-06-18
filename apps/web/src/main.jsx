import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { deleteResource, getHealth, getResources, postJson, updateResource, uploadResource } from "./api";
import { createDefaultMap, initialBooks } from "./sampleData";
import { sceneToPlainNodes, structureToScene } from "./excalidrawScene";

const store = {
  read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Could not persist ${key}.`, error);
    }
  }
};

function mergeBooks(...groups) {
  const seen = new Set();
  return groups.flat().filter((book) => {
    if (!book?.id || seen.has(book.id)) return false;
    seen.add(book.id);
    return true;
  });
}

function canCreateLocalResource(form) {
  const file = form.get("resource");
  const text = cleanFormText(form.get("supplementalText"));
  return !hasSelectedFile(file) && Boolean(text);
}

function createLocalResource(form) {
  const text = cleanFormText(form.get("supplementalText"));
  const language = cleanFormText(form.get("language")) || "中文";
  const paragraphs = extractParagraphs(text);

  if (!paragraphs.length) {
    throw new Error("没有发现可导入的正文段落。");
  }

  return {
    id: `local-book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: cleanFormText(form.get("title")) || paragraphs[0].slice(0, 28) || "未命名资源",
    author: cleanFormText(form.get("author")) || "本地文本",
    language,
    type: "个人资源",
    sourceFormat: "manual",
    fileName: "",
    fileSize: 0,
    importStatus: "ready",
    importNote: "手动正文已导入本地书架。",
    tags: ["个人资源", language, "manual"],
    paragraphs,
    storage: {
      provider: "localStorage",
      persistedAt: new Date().toISOString(),
      parsedResourcePath: "ks-local-resources-v1",
      file: null
    }
  };
}

function applyBookChanges(book, changes) {
  const tags = Array.isArray(changes.tags) ? changes.tags : String(changes.tags || "").split(/[,，]/);
  return {
    ...book,
    title: cleanFormText(changes.title) || book.title,
    author: cleanFormText(changes.author) || book.author,
    language: cleanFormText(changes.language) || book.language,
    tags: tags.map((tag) => cleanFormText(tag)).filter(Boolean),
    storage: {
      ...(book.storage || {}),
      updatedAt: new Date().toISOString()
    }
  };
}

function isLocalResource(book) {
  return book?.storage?.provider === "localStorage" || String(book?.id || "").startsWith("local-book-");
}

function hasSelectedFile(file) {
  return Boolean(file && typeof file.name === "string" && file.name && file.size > 0);
}

function cleanFormText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}|\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 240);
}

function App() {
  const [view, setView] = useState("bookshelf");
  const [localResources, setLocalResources] = useStoredState("ks-local-resources-v1", []);
  const [books, setBooks] = useState(() => mergeBooks(localResources, initialBooks));
  const [maps, setMaps] = useStoredState("ks-maps-v3", [createDefaultMap(initialBooks[0])]);
  const [selectedBookId, setSelectedBookId] = useState(initialBooks[0].id);
  const [selectedParagraph, setSelectedParagraph] = useState(0);
  const [selectedMapId, setSelectedMapId] = useState(`map-${initialBooks[0].id}`);
  const [draft, setDraft] = useStoredState(
    "ks-draft",
    "<h2>稀缺资源如何分配</h2><p>我想讨论政治、经济、社会三种资源分配之间的关系。</p>"
  );
  const [questions, setQuestions] = useState([]);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [translation, setTranslation] = useState({ source: "", target: "English", output: "" });
  const [translationLoading, setTranslationLoading] = useState(false);
  const [loading, setLoading] = useState("");
  const [health, setHealth] = useState({ ok: false, aiConfigured: false });
  const sceneSaveTimer = useRef(null);

  const selectedBook = books.find((book) => book.id === selectedBookId) || books[0];
  const selectedMap = maps.find((map) => map.id === selectedMapId) || maps[0];

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false, aiConfigured: false }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getResources()
      .then((resources) => {
        if (cancelled) return;
        setBooks(mergeBooks(resources, localResources, initialBooks));
      })
      .catch(() => {
        if (!cancelled) setBooks(mergeBooks(localResources, initialBooks));
      });
    return () => {
      cancelled = true;
    };
  }, [localResources]);

  async function generateStructure() {
    setLoading("正在用 AI 预生成结构图...");
    try {
      const structure = await postJson("/api/structure", {
        title: selectedBook.title,
        paragraphs: selectedBook.paragraphs
      });
      const map = {
        id: `map-${Date.now()}`,
        title: structure.title || `${selectedBook.title} 结构图`,
        sourceBookId: selectedBook.id,
        structure,
        scene: {
          elements: structureToScene(structure),
          appState: { viewBackgroundColor: "#ffffff" },
          files: {}
        }
      };
      setMaps((current) => [map, ...current.filter((item) => item.sourceBookId !== selectedBook.id)]);
      setSelectedMapId(map.id);
    } finally {
      setLoading("");
    }
  }

  async function generateQuestions() {
    setQuestionLoading(true);
    try {
      const result = await postJson("/api/questions", {
        mapTitle: selectedMap?.title,
        nodes: selectedMap?.scene?.elements ? sceneToPlainNodes(selectedMap.scene.elements) : selectedMap?.structure?.nodes,
        draft
      });
      setQuestions(result.questions || []);
    } finally {
      setQuestionLoading(false);
    }
  }

  async function translateText() {
    setTranslationLoading(true);
    try {
      const result = await postJson("/api/translate", {
        text: translation.source || stripHtml(draft),
        target: translation.target
      });
      setTranslation((current) => ({ ...current, output: result.output || "" }));
    } finally {
      setTranslationLoading(false);
    }
  }

  function saveScene(scene) {
    if (!selectedMap) return;
    const serializableScene = serializeScene(scene);
    window.clearTimeout(sceneSaveTimer.current);
    sceneSaveTimer.current = window.setTimeout(() => {
      setMaps((current) => current.map((map) => (map.id === selectedMap.id ? { ...map, scene: serializableScene } : map)));
    }, 250);
  }

  async function addResource(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setLoading("正在导入资源...");
    try {
      let book;
      try {
        book = await uploadResource(form);
      } catch (error) {
        if (!canCreateLocalResource(form)) throw error;
        console.warn("[resource-local-fallback]", error);
        book = createLocalResource(form);
        setLocalResources((current) => mergeBooks([book], current));
      }
      setBooks((current) => mergeBooks([book], current));
      setSelectedBookId(book.id);
      formElement.reset();
    } finally {
      setLoading("");
    }
  }

  async function removeResource(book) {
    if (!window.confirm(`删除「${book.title}」？这会同时移除它关联的结构图。`)) return;
    setLoading("正在删除资源...");
    try {
      if (!isLocalResource(book)) {
        await deleteResource(book.id).catch((error) => {
          console.warn("[resource-delete-warning]", error);
        });
      }
      setLocalResources((current) => current.filter((item) => item.id !== book.id));
      setBooks((current) => {
        const remaining = current.filter((item) => item.id !== book.id);
        if (selectedBookId === book.id) {
          setSelectedBookId(remaining[0]?.id || "");
          setSelectedParagraph(0);
        }
        return remaining;
      });
      setMaps((current) => {
        const remaining = current.filter((map) => map.sourceBookId !== book.id);
        if (remaining.length && !remaining.some((map) => map.id === selectedMapId)) {
          setSelectedMapId(remaining[0].id);
        }
        return remaining;
      });
      if (view === "reader" && selectedBookId === book.id) setView("bookshelf");
    } finally {
      setLoading("");
    }
  }

  async function editResource(book, changes) {
    setLoading("正在保存书籍信息...");
    try {
      const updated = isLocalResource(book) ? applyBookChanges(book, changes) : book.storage ? await updateResource(book.id, changes) : { ...book, ...changes };
      if (isLocalResource(updated)) {
        setLocalResources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      }
      setBooks((current) => current.map((item) => (item.id === book.id ? updated : item)));
    } finally {
      setLoading("");
    }
  }

  return (
    <div className={`appShell view-${view}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView("bookshelf")}>
          <span className="mark">KS</span>
          <span>
            <strong>Knowledge Studio</strong>
            <small>Reader + Excalidraw + AI API</small>
          </span>
        </button>
        <nav className="tabs">
          {["bookshelf", "reader", "library", "editor", "publish"].map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {{ bookshelf: "书架", reader: "阅读器", library: "结构图", editor: "编辑", publish: "发布与转译" }[item]}
            </button>
          ))}
        </nav>
        <span className={`apiPill ${health.aiConfigured ? "ready" : ""}`}>
          {health.aiConfigured ? "AI 已连接" : "AI fallback"}
        </span>
      </header>

      {loading ? <div className="loading">{loading}</div> : null}

      {view === "bookshelf" ? (
        <Bookshelf
          books={books}
          onRead={(book) => { setSelectedBookId(book.id); setView("reader"); }}
          onAdd={addResource}
          onDelete={removeResource}
          onEdit={editResource}
        />
      ) : null}

      {view === "reader" ? (
        <Reader
          book={selectedBook}
          paragraphIndex={selectedParagraph}
          setParagraphIndex={setSelectedParagraph}
          map={selectedMap}
          onGenerate={generateStructure}
          onSceneChange={saveScene}
        />
      ) : null}

      {view === "library" ? (
        <MapLibrary maps={maps} books={books} onOpen={(map) => { setSelectedMapId(map.id); setView("editor"); }} />
      ) : null}

      {view === "editor" ? (
        <EditorPanel
          map={selectedMap}
          draft={draft}
          setDraft={setDraft}
          questions={questions}
          questionLoading={questionLoading}
          generateQuestions={generateQuestions}
        />
      ) : null}

      {view === "publish" ? (
        <PublishPanel
          draft={draft}
          translation={translation}
          setTranslation={setTranslation}
          translationLoading={translationLoading}
          onTranslate={translateText}
        />
      ) : null}
    </div>
  );
}

function Bookshelf({ books, onRead, onAdd, onDelete, onEdit }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileName, setFileName] = useState("");
  const [editingBook, setEditingBook] = useState(null);
  const [submitError, setSubmitError] = useState("");

  function getTitleSize(title) {
    const weightedLength = Array.from(title || "").reduce((total, char) => {
      if (/\s/.test(char)) return total + 0.25;
      if (/[\u4e00-\u9fff]/.test(char)) return total + 1.15;
      if (/[A-Z]/.test(char)) return total + 0.72;
      if (/[.,:;_｜|/\\-]/.test(char)) return total + 0.32;
      return total + 0.58;
    }, 0);

    const size = Math.max(13, Math.min(24, 30 - weightedLength * 0.4));
    return `${size.toFixed(1)}px`;
  }

  async function handleAdd(event) {
    try {
      setSubmitError("");
      await onAdd(event);
      setFileName("");
    } catch (error) {
      setSubmitError(error.message || "保存失败，请稍后再试。");
    }
  }

  async function handleEdit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onEdit(editingBook, {
      title: form.get("title"),
      author: form.get("author"),
      language: form.get("language"),
      tags: String(form.get("tags") || "").split(/[,，]/)
    });
    setEditingBook(null);
  }

  return (
    <main className={sidebarCollapsed ? "bookshelfLayout sidebarCollapsed" : "bookshelfLayout"}>
      <aside className="bookshelfSidebar">
        <div className="bookshelfSidebarTop">
          <strong>添加资源</strong>
          <button
            className="sidebarToggle"
            type="button"
            aria-label={sidebarCollapsed ? "展开添加资源侧边栏" : "收起添加资源侧边栏"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? "›" : "‹"}
          </button>
        </div>
        {!sidebarCollapsed ? (
          <form className="resourceForm" onSubmit={handleAdd}>
            <p>上传阅读材料，解析后会进入右侧书架。</p>
            <label className="uploadBox">
              <span>上传文件</span>
              <span className="filePicker">
                <span className="fileButton">选择文件</span>
                <span className="fileName">{fileName || "未选择任何文件"}</span>
              </span>
              <input
                name="resource"
                className="fileInput"
                type="file"
                accept=".txt,.text,.md,.markdown,.html,.htm,.pdf,.epub,.mobi,.azw3,text/plain,text/markdown,text/html,application/pdf,application/epub+zip"
                onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
              />
              <small>支持 TXT、Markdown、HTML、PDF、EPUB、MOBI、AZW3。TXT、Markdown、HTML、EPUB 会直接解析；PDF、MOBI、AZW3 可先补充正文。</small>
            </label>
            <input name="title" placeholder="标题" />
            <input name="author" placeholder="作者或来源" />
            <select name="language"><option>中文</option><option>English</option><option>Espanol</option></select>
            <textarea name="supplementalText" rows="6" placeholder="可选：为 PDF、MOBI、AZW3 或解析失败的 EPUB 补充可先阅读的正文；或在没有文件时粘贴文本。" />
            {submitError ? <p className="formError" role="alert">{submitError}</p> : null}
            <button type="submit">保存到书架</button>
          </form>
        ) : null}
      </aside>
      <section className="bookshelfMain">
        <div className="sectionHead">
          <div>
            <h1>书架</h1>
            <p>资源只负责进入阅读，结构图在阅读器里基于文本生成。</p>
          </div>
        </div>
        <div className="bookGrid">
          {!books.length ? <p className="emptyState">还没有资源。先从左侧上传一本书或一份材料。</p> : null}
          {books.slice(0, 4).map((book) => (
            <article className="bookCard" key={book.id}>
              <div className="meta">{book.language} / {book.type}</div>
              <h2 style={{ "--title-size": getTitleSize(book.title) }} title={book.title}>{book.title}</h2>
              <p>{book.author}</p>
              {book.importNote ? <p className="importNote">{book.importNote}</p> : null}
              <div className="tags">{book.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="bookActions">
                <button onClick={() => onRead(book)}>开始阅读</button>
                <button type="button" onClick={() => setEditingBook(book)}>编辑</button>
                <button className="dangerButton" onClick={() => onDelete(book)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {editingBook ? (
        <div className="editOverlay" role="dialog" aria-modal="true" aria-label="编辑书籍信息">
          <form className="editPanel" onSubmit={handleEdit}>
            <div className="editPanelHead">
              <strong>编辑书籍信息</strong>
              <button type="button" onClick={() => setEditingBook(null)} aria-label="关闭编辑">×</button>
            </div>
            <label>
              <span>书名</span>
              <input name="title" defaultValue={editingBook.title} required />
            </label>
            <label>
              <span>作者或来源</span>
              <input name="author" defaultValue={editingBook.author} />
            </label>
            <label>
              <span>语言</span>
              <select name="language" defaultValue={editingBook.language || "中文"}>
                <option>中文</option>
                <option>English</option>
                <option>Espanol</option>
              </select>
            </label>
            <label>
              <span>标签</span>
              <input name="tags" defaultValue={(editingBook.tags || []).join("，")} placeholder="用逗号分隔标签" />
            </label>
            <div className="editActions">
              <button type="button" onClick={() => setEditingBook(null)}>取消</button>
              <button type="submit">保存修改</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function Reader({ book, paragraphIndex, setParagraphIndex, map, onGenerate, onSceneChange }) {
  const initialData = useMemo(() => {
    if (map?.scene) return map.scene;
    return {
      elements: structureToScene(map?.structure || createDefaultMap(book).structure),
      appState: { viewBackgroundColor: "#ffffff" },
      scrollToContent: true
    };
  }, [book, map]);

  return (
    <main className="readerScreen">
      <aside className="readerDoc">
        <h1>{book.title}</h1>
        <p className="byline">{book.author}</p>
        {book.paragraphs.map((paragraph, index) => (
          <button
            key={`${book.id}-${index}`}
            className={paragraphIndex === index ? "paragraph selected" : "paragraph"}
            onClick={() => setParagraphIndex(index)}
          >
            {paragraph}
          </button>
        ))}
      </aside>
      <section className="whiteboardPane">
        <div className="whiteboardTop">
          <button onClick={onGenerate}>AI 预生成结构图</button>
        </div>
        <div className="excalidrawHost">
          <Excalidraw
            key={map?.id || book.id}
            initialData={initialData}
            onChange={(elements, appState, files) => onSceneChange({ elements, appState, files })}
          />
        </div>
      </section>
    </main>
  );
}

function MapLibrary({ maps, books, onOpen }) {
  return (
    <main className="page">
      <section className="sectionHead">
        <div>
          <h1>结构图</h1>
          <p>点击结构图进入编辑页，左侧会展示该结构。</p>
        </div>
      </section>
      <div className="mapGrid">
        {maps.map((map) => (
          <button className="mapCard" key={map.id} onClick={() => onOpen(map)}>
            <strong>{map.title}</strong>
            <span>{books.find((book) => book.id === map.sourceBookId)?.title || "自建资源"}</span>
            <small>{map.scene?.elements?.length || map.structure?.nodes?.length || 0} 个元素</small>
          </button>
        ))}
      </div>
    </main>
  );
}

function EditorPanel({ map, draft, setDraft, questions, questionLoading, generateQuestions }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "从结构图的问题开始写。这里支持中文输入、换行、段落、标题和引用。"
      })
    ],
    content: draft,
    editorProps: {
      attributes: {
        class: "tiptapEditor"
      }
    },
    onUpdate({ editor }) {
      setDraft(editor.getHTML());
    }
  });

  function appendQuestion(question) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(`<blockquote><p>${escapeHtml(question)}</p></blockquote><p></p>`)
      .run();
  }

  return (
    <main className="editorScreen">
      <aside className="structureRail">
        <h2>{map?.title || "结构图"}</h2>
        {(map?.structure?.nodes || []).map((node, index) => (
          <div className="outlineNode" key={`${node.text}-${index}`}>
            <span>{node.kind}</span>
            {node.text}
          </div>
        ))}
      </aside>
      <section className="draftPane">
        <div className="sectionHead">
          <div>
            <h1>写作</h1>
            <p>在这里把结构图发展成文章，AI 出题会从当前结构和草稿生成。</p>
          </div>
          <button onClick={generateQuestions} disabled={questionLoading}>
            AI 出题
          </button>
        </div>
        <div className="questionPanel">
          <div className="questionPanelTitle">题目</div>
          <div className="questionRow">
            {questionLoading ? <div className="questionStatus">正在生成写作问题...</div> : null}
            {questions.map((question) => (
              <button key={question} onClick={() => appendQuestion(question)}>
                {question}
              </button>
            ))}
          </div>
        </div>
        <EditorContent editor={editor} className="richEditor" />
      </section>
    </main>
  );
}

function PublishPanel({ draft, translation, setTranslation, translationLoading, onTranslate }) {
  const text = translation.source || stripHtml(draft);
  const outputText = translationLoading ? "正在 AI 转译..." : translation.output;
  return (
    <main className="page">
      <section className="sectionHead">
        <div>
          <h1>发布与转译</h1>
        </div>
      </section>
      <div className="translationGrid">
        <section className="translationPanel sourcePanel">
          <div className="translationPanelHead">
            <span>可转译文本</span>
            <div className="translateTools">
              <select value={translation.target} onChange={(event) => setTranslation({ ...translation, target: event.target.value })}>
                <option>English</option>
                <option>Spanish</option>
                <option>Chinese</option>
              </select>
              <button className="paperButton" onClick={onTranslate} disabled={translationLoading}>
                {translationLoading ? "转译中" : "AI转译"}
              </button>
            </div>
          </div>
          <textarea value={text} onChange={(event) => setTranslation({ ...translation, source: event.target.value })} />
        </section>
        <section className="translationPanel">
          <div className="translationPanelHead">
            <span>转译结果</span>
          </div>
          <textarea
            value={outputText}
            readOnly={translationLoading}
            onChange={(event) => setTranslation({ ...translation, output: event.target.value })}
          />
        </section>
      </div>
    </main>
  );
}

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => store.read(key, fallback));
  useEffect(() => store.write(key, value), [key, value]);
  return [value, setValue];
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ui-error]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="page">
          <section className="errorPanel">
            <h1>页面渲染失败</h1>
            <p>{this.state.error.message}</p>
            <button onClick={() => { localStorage.removeItem("ks-maps-v3"); window.location.reload(); }}>清理白板缓存并刷新</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function serializeScene(scene) {
  return {
    elements: (scene.elements || []).map((element) => ({ ...element })),
    appState: {
      viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff",
      currentItemStrokeColor: scene.appState?.currentItemStrokeColor,
      currentItemBackgroundColor: scene.appState?.currentItemBackgroundColor,
      currentItemFillStyle: scene.appState?.currentItemFillStyle,
      currentItemStrokeWidth: scene.appState?.currentItemStrokeWidth,
      currentItemRoughness: scene.appState?.currentItemRoughness,
      currentItemOpacity: scene.appState?.currentItemOpacity
    },
    files: scene.files || {}
  };
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
