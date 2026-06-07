import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { deleteResource, getHealth, getResources, postJson, uploadResource } from "./api";
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

function App() {
  const [view, setView] = useState("bookshelf");
  const [books, setBooks] = useStoredState("ks-books", initialBooks);
  const [maps, setMaps] = useStoredState("ks-maps-v3", [createDefaultMap(initialBooks[0])]);
  const [selectedBookId, setSelectedBookId] = useState(initialBooks[0].id);
  const [selectedParagraph, setSelectedParagraph] = useState(0);
  const [selectedMapId, setSelectedMapId] = useState(`map-${initialBooks[0].id}`);
  const [draft, setDraft] = useStoredState(
    "ks-draft",
    "<h2>稀缺资源如何分配</h2><p>我想讨论政治、经济、社会三种资源分配之间的关系。</p>"
  );
  const [questions, setQuestions] = useState([]);
  const [translation, setTranslation] = useState({ source: "", target: "English", output: "" });
  const [loading, setLoading] = useState("");
  const [health, setHealth] = useState({ ok: false, aiConfigured: false });
  const sceneSaveTimer = useRef(null);

  const selectedBook = books.find((book) => book.id === selectedBookId) || books[0];
  const selectedMap = maps.find((map) => map.id === selectedMapId) || maps[0];

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false, aiConfigured: false }));
  }, []);

  useEffect(() => {
    getResources()
      .then((resources) => {
        if (!resources.length) return;
        setBooks((current) => {
          const existingIds = new Set(current.map((book) => book.id));
          const incoming = resources.filter((book) => !existingIds.has(book.id));
          return incoming.length ? [...incoming, ...current] : current;
        });
      })
      .catch(() => {});
  }, [setBooks]);

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
    setLoading("正在生成写作问题...");
    try {
      const result = await postJson("/api/questions", {
        mapTitle: selectedMap?.title,
        nodes: selectedMap?.scene?.elements ? sceneToPlainNodes(selectedMap.scene.elements) : selectedMap?.structure?.nodes,
        draft
      });
      setQuestions(result.questions || []);
    } finally {
      setLoading("");
    }
  }

  async function translateText() {
    setLoading("正在 AI 转译...");
    try {
      const result = await postJson("/api/translate", {
        text: translation.source || stripHtml(draft),
        target: translation.target
      });
      setTranslation((current) => ({ ...current, output: result.output || "" }));
    } finally {
      setLoading("");
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
    setLoading("正在导入资源...");
    try {
      const form = new FormData(event.currentTarget);
      const book = await uploadResource(form);
      setBooks((current) => [book, ...current]);
      setSelectedBookId(book.id);
      event.currentTarget.reset();
    } finally {
      setLoading("");
    }
  }

  async function removeResource(book) {
    if (!window.confirm(`删除「${book.title}」？这会同时移除它关联的结构图。`)) return;
    setLoading("正在删除资源...");
    try {
      await deleteResource(book.id).catch((error) => {
        console.warn("[resource-delete-warning]", error);
      });
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

  return (
    <div className="appShell">
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
        <EditorPanel map={selectedMap} draft={draft} setDraft={setDraft} questions={questions} generateQuestions={generateQuestions} />
      ) : null}

      {view === "publish" ? (
        <PublishPanel draft={draft} translation={translation} setTranslation={setTranslation} onTranslate={translateText} />
      ) : null}
    </div>
  );
}

function Bookshelf({ books, onRead, onAdd, onDelete }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
          <form className="resourceForm" onSubmit={onAdd}>
            <p>上传阅读材料，解析后会进入右侧书架。</p>
            <label className="uploadBox">
              <span>上传文件</span>
              <input
                name="resource"
                type="file"
                accept=".txt,.text,.md,.markdown,.html,.htm,.pdf,.epub,.mobi,.azw3,text/plain,text/markdown,text/html,application/pdf,application/epub+zip"
              />
              <small>支持 TXT、Markdown、HTML、PDF、EPUB、MOBI、AZW3。TXT、Markdown、HTML、EPUB 会直接解析；PDF、MOBI、AZW3 可先补充正文。</small>
            </label>
            <input name="title" placeholder="标题" />
            <input name="author" placeholder="作者或来源" />
            <select name="language"><option>中文</option><option>English</option><option>Espanol</option></select>
            <textarea name="supplementalText" rows="6" placeholder="可选：为 PDF、MOBI、AZW3 或解析失败的 EPUB 补充可先阅读的正文；或在没有文件时粘贴文本。" />
            <button>保存到书架</button>
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
          {books.map((book) => (
            <article className="bookCard" key={book.id}>
              <div className="meta">{book.language} / {book.type}</div>
              <h2>{book.title}</h2>
              <p>{book.author}</p>
              {book.importNote ? <p className="importNote">{book.importNote}</p> : null}
              <div className="tags">{book.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="bookActions">
                <button onClick={() => onRead(book)}>开始阅读</button>
                <button className="dangerButton" onClick={() => onDelete(book)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>
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

function EditorPanel({ map, draft, setDraft, questions, generateQuestions }) {
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
            <h1>编辑</h1>
            <p>在这里把结构图发展成文章，AI 出题会从当前结构和草稿生成。</p>
          </div>
          <button onClick={generateQuestions}>AI 出题</button>
        </div>
        <div className="questionPanel">
          <div className="questionPanelTitle">题目</div>
          <div className="questionRow">
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

function PublishPanel({ draft, translation, setTranslation, onTranslate }) {
  const text = translation.source || stripHtml(draft);
  return (
    <main className="page">
      <section className="sectionHead">
        <div>
          <h1>发布与转译</h1>
        </div>
        <select value={translation.target} onChange={(event) => setTranslation({ ...translation, target: event.target.value })}>
          <option>English</option>
          <option>Spanish</option>
          <option>Chinese</option>
        </select>
        <button onClick={onTranslate}>AI 转译</button>
      </section>
      <div className="translationGrid">
        <label>可转译文本<textarea value={text} onChange={(event) => setTranslation({ ...translation, source: event.target.value })} /></label>
        <label>转译结果<textarea value={translation.output} onChange={(event) => setTranslation({ ...translation, output: event.target.value })} /></label>
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
