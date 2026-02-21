"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  listConversations,
  getMessages,
  createConversation,
  streamMessage,
  executePlugin,
  getPluginRuns,
  renameConversation,
  deleteConversation,
  type PluginRun,
} from "@/lib/api";

const PINE_RULES = `
You are a senior Pine Script v5 engineer.

STRICT RULES:

- Pine version MUST always be //@version=5
- Never multiply or add boolean series.
- Use ta.crossover() and ta.crossunder() for signals.
- Never compare EMA values directly for cross logic using > or <.
- Always declare variables before use.
- Never introduce new variable names if a similar one already exists.
- Preserve existing variable names exactly.
- Indentation: 2 spaces.
- Do not restart the script unless explicitly told to.
- If EXISTING CODE is provided, MODIFY it — do NOT rewrite from scratch.
- Output ONE fenced code block only.
- No explanations.
- No comments unless necessary.
- No markdown outside the code block.
`;



type Conversation = {
  id: string;
  title?: string | null;
  created_at?: string;
  updated_at: string;
};
type Msg = {
  id: string;
  role: string;
  content: string;
  attachments?: { id: string; name: string; url: string }[];
};



export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlConversationId = searchParams.get("c"); // ?c=<id>
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // =========================
  // Image attachments (screenshots) + OCR
  // =========================
  type ImageAttachment = { id: string; file: File; url: string; ocrText?: string };
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pluginName, setPluginName] = useState<
    "healthcheck" | "summariseConversation" | "exportConversation"
  >("summariseConversation");

  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);

  const [pluginResult, setPluginResult] = useState<unknown>(null);
  const [pluginRuns, setPluginRuns] = useState<PluginRun[]>([]);

  // last tool event emitted from /api/chat/stream (server sends `event: tool`)
  const [lastToolEvent, setLastToolEvent] = useState<ToolEvent | null>(null);

  const [titles, setTitles] = useState<Record<string, string>>({});
  const [convSearch, setConvSearch] = useState("");

  // =========================
  // Layout: resizable panels
  // =========================
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(288); // px (w-72)
  const [codeWidth, setCodeWidth] = useState(420); // px
  const draggingRef = useRef<null | "sidebar" | "code">(null);

  useEffect(() => {
    // Restore layout
    try {
      const raw = localStorage.getItem("t4n_layout");
      if (raw) {
        const v = JSON.parse(raw) as {
          sidebarOpen?: boolean;
          sidebarWidth?: number;
          codeWidth?: number;
        };
        if (typeof v.sidebarOpen === "boolean") setSidebarOpen(v.sidebarOpen);
        if (typeof v.sidebarWidth === "number") setSidebarWidth(v.sidebarWidth);
        if (typeof v.codeWidth === "number") setCodeWidth(v.codeWidth);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Persist layout
    try {
      localStorage.setItem(
        "t4n_layout",
        JSON.stringify({ sidebarOpen, sidebarWidth, codeWidth }),
      );
    } catch {
      // ignore
    }
  }, [sidebarOpen, sidebarWidth, codeWidth]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;

      if (draggingRef.current === "sidebar") {
        // Sidebar width = mouse X from left edge
        const next = Math.max(220, Math.min(520, e.clientX));
        setSidebarWidth(next);
      }

      if (draggingRef.current === "code") {
        // Code width = right edge - mouse X
        const viewportW = window.innerWidth;
        const next = Math.max(280, Math.min(800, viewportW - e.clientX));
        setCodeWidth(next);
      }
    }

    function onUp() {
      draggingRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // =========================
  // Code panel (auto-detect + manual toggle)
  // =========================
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeText, setCodeText] = useState<string>("");

  type SavedCode = { id: string; name: string; code: string; createdAt: string };

  const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
  const [activeCodeId, setActiveCodeId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("t4n_saved_codes");
      if (raw) setSavedCodes(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("t4n_saved_codes", JSON.stringify(savedCodes));
    } catch {
      // ignore
    }
  }, [savedCodes]);

  function saveCurrentCode() {
    if (!codeText.trim()) return;
    const id = globalThis.crypto.randomUUID();
    const item: SavedCode = {
      id,
      name: `Snippet ${savedCodes.length + 1}`,
      code: codeText,
      createdAt: new Date().toISOString(),
    };
    setSavedCodes((p) => [item, ...p]);
    setActiveCodeId(id);
  }

  function updateActiveSnippet() {
    if (!activeCodeId) return;
    if (!codeText.trim()) return;

    setSavedCodes((p) =>
      p.map((x) => (x.id === activeCodeId ? { ...x, code: codeText } : x)),
    );
  }


  function renameSnippet(id: string) {
    const next = prompt("Rename snippet:");
    if (!next) return;
    setSavedCodes((p) => p.map((x) => (x.id === id ? { ...x, name: next } : x)));
  }

  function deleteSnippet(id: string) {
    if (!confirm("Delete this snippet?")) return;
    setSavedCodes((p) => p.filter((x) => x.id !== id));
    setActiveCodeId((cur) => (cur === id ? null : cur));
  }


  const wantsCodeRef = useRef(false);

  function promptLooksLikeCodeRequest(text: string) {
    return /(\bcode\b|\bscript\b|\btradingview\b|\bpine\b|\bpinescript\b|\bimplement\b|\bwrite\b|\btsx\b|\bts\b|\bjs\b|\bpython\b|\bsql\b|\bendpoint\b|\bapi\b)/i.test(
      text,
    );
  }

  function looksLikeEditRequest(text: string) {
    return /(\bchange\b|\bmodify\b|\bupdate\b|\bedit\b|\breplace\b|\bset\b|\bturn\b|\bmake\b|\bcolour\b|\bcolor\b|\bblue\b|\bred\b|\bgreen\b)/i.test(
      text,
    );
  }


  function stripCodeBlocks(text: string) {
    return text
      .replace(/```[\w+-]*\n[\s\S]*?```/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractCodeBlocks(text: string) {
    // 1) Closed fenced blocks: ```lang\n...\n```
    const re = /```([\w+-]*)\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      const langRaw = (m[1] || "").trim();
      const lang = langRaw.toLowerCase();
      const body = (m[2] || "").replace(/\s+$/, "");

      // Don’t prepend anything that could break Pine’s required first line (//@version=5)
      const shouldAnnotateLang = !!lang && lang !== "pinescript" && lang !== "pine";

      blocks.push(`${shouldAnnotateLang ? `// ${langRaw}\n` : ""}${body}`);
    }

    if (blocks.length > 0) {
      return blocks.join("\n\n// ------------------------\n\n");
    }

    // 2) Partial / unclosed fence (common when user presses Stop mid-stream)
    const fenceStart = text.indexOf("```");
    if (fenceStart !== -1) {
      const after = text.slice(fenceStart + 3);
      const nl = after.indexOf("\n");
      if (nl !== -1) {
        const langRaw = after.slice(0, nl).trim();
        const lang = langRaw.toLowerCase();
        const body = after.slice(nl + 1).replace(/\s+$/, "");

        const shouldAnnotateLang = !!lang && lang !== "pinescript" && lang !== "pine";

        if (body.trim()) return `${shouldAnnotateLang ? `// ${langRaw}\n` : ""}${body}`;
      }

    }

    // 3) Pine Script heuristics even without fences
    // Detect common Pine signatures
    const looksLikePine =
      /(^|\n)\s*\/\/@version=\d+/i.test(text) ||
      /(^|\n)\s*(indicator|strategy)\s*\(/i.test(text) ||
      /(^|\n)\s*(plot|plotshape|plotchar|hline)\s*\(/i.test(text);

    if (looksLikePine) {
      // Try to start from //@version line if present, else from first indicator/strategy
      const verIdx = text.search(/(^|\n)\s*\/\/@version=\d+/i);
      const indIdx = text.search(/(^|\n)\s*(indicator|strategy)\s*\(/i);
      const startIdx = verIdx !== -1 ? verIdx : indIdx !== -1 ? indIdx : 0;

      const body = text.slice(startIdx).replace(/\s+$/, "");
      if (body.trim()) return body;
    }

    return "";
  }


  function makeTitleFromText(text: string) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    return cleaned.length > 32 ? cleaned.slice(0, 32) + "…" : cleaned;
  }

  function makeTitleFromMessages(msgs: Msg[]) {
    const firstUser = msgs.find((m) => m.role === "user")?.content ?? "";
    return makeTitleFromText(firstUser);
  }

  const activeAssistantIdRef = useRef<string | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);

  const stoppedByUserRef = useRef(false);

  const lastSendRef = useRef<{ text: string; conversationId?: string } | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  function cancelStreamSilently() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setLoading(false);
    activeAssistantIdRef.current = null;
  }


  function stopStreaming() {
    stoppedByUserRef.current = true;

    abortRef.current?.abort();
    abortRef.current = null;

    setCanRetry(true);

    // Optional UX: mark the current assistant message as stopped
    const aid = activeAssistantIdRef.current;
    lastAssistantIdRef.current = aid;

    if (aid) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aid
            ? {
              ...msg,
              content: (msg.content || "").trimEnd() + "\n\n[Stopped]",
            }
            : msg,
        ),
      );
    }

    setStreaming(false);
    setLoading(false);
    activeAssistantIdRef.current = null;
  }


  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function downloadTextFile(filename: string, text: string, mime = "text/markdown") {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function ocrImage(file: File): Promise<string> {
    // dynamic import keeps initial bundle smaller
    const mod = await import("tesseract.js");
    const Tesseract = mod.default;

    const url = URL.createObjectURL(file);
    try {
      const result = await Tesseract.recognize(url, "eng");
      return String(result?.data?.text ?? "").trim();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleAttachArray(files: File[]) {
    if (!files || files.length === 0) return;

    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;

    const items: ImageAttachment[] = imgs.map((file) => ({
      id: globalThis.crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));

    setAttachments((prev) => [...prev, ...items]);

    // OCR only the most recent image (fast + useful)
    const latest = items[items.length - 1];
    if (!latest) return;

    setOcrBusy(true);
    try {
      const text = await ocrImage(latest.file);
      setAttachments((prev) =>
        prev.map((a) => (a.id === latest.id ? { ...a, ocrText: text } : a)),
      );
    } catch {
      setAttachments((prev) =>
        prev.map((a) => (a.id === latest.id ? { ...a, ocrText: "" } : a)),
      );
    } finally {
      setOcrBusy(false);
    }
  }

  async function handleAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await handleAttachArray(Array.from(files));
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearAttachments(opts?: { revokeUrls?: boolean }) {
    const revokeUrls = opts?.revokeUrls ?? true;

    setAttachments((prev) => {
      if (revokeUrls) {
        for (const a of prev) {
          if (a.url) URL.revokeObjectURL(a.url);
        }
      }
      return [];
    });
  }


  function friendlyError(msg: string) {
    const m = msg.toLowerCase();

    if (m.includes("llm disabled") || m.includes("cloud mode") || m.includes("disabled in cloud")) {
      return "AI is disabled on the free cloud deploy. To use Llama/DeepSeek, run t4n-api locally with Ollama enabled (local mode), then point the web app at your local API.";
    }
    return msg;
  }

  useEffect(() => {
    // If URL has ?c=..., open that conversation
    if (urlConversationId && urlConversationId !== activeId) {
      void openConversation(urlConversationId);
      return;
    }

    // If URL cleared, clear selection
    if (!urlConversationId && activeId) {
      setActiveId(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlConversationId]);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function refreshConversations() {
    try {
      const res = await listConversations();
      if (!res.ok) {
        setError(res.error);
        return;
      }

      const list = res.data.conversations as Conversation[];
      setConversations(list);

      // ✅ Pull DB titles into local title cache (so sidebar/search uses them)
      setTitles((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const c of list) {
          const t = (c.title ?? "").trim();
          if (t && next[c.id] !== t) {
            next[c.id] = t;
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("t4n_conversation_titles");
      if (raw) setTitles(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("t4n_conversation_titles", JSON.stringify(titles));
    } catch {
      // ignore
    }
  }, [titles]);


  useEffect(() => {
    void refreshConversations();
  }, []);

  const filteredConversations = (() => {
    const q = convSearch.trim().toLowerCase();
    if (!q) return conversations;

    return conversations.filter((c) => {
      const bestTitle = (titles[c.id] ?? c.title ?? "").toLowerCase();
      const id = c.id.toLowerCase();
      return bestTitle.includes(q) || id.includes(q);
    });
  })();


  async function startNewChat(): Promise<string | null> {
    let createdId: string | null = null;

    const action = async () => {
      // If a stream is in progress, cancel it before switching chats
      if (streaming) cancelStreamSilently();

      try {
        setError(null);
        setLoading(true);

        const res = await createConversation();
        if (!res.ok) throw new Error(res.error);

        const id = res.data.conversationId;
        createdId = id;

        router.push(`/?c=${encodeURIComponent(id)}`);
        setActiveId(id);
        setMessages([]);

        setConversations((prev) => {
          const exists = prev.some((c) => c.id === id);
          if (exists) return prev;
          return [{ id, updated_at: new Date().toISOString() }, ...prev];
        });

        setTimeout(() => inputRef.current?.focus(), 0);
        void refreshConversations();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create a new chat";
        setError(friendlyError(msg));
      } finally {
        setLoading(false);
        setStreaming(false);
      }
    };

    await action();
    return createdId;
  }

  async function refreshPluginRuns(conversationId: string) {
    try {
      const res = await getPluginRuns(conversationId, 25);
      if (res.ok) setPluginRuns(res.data.runs || []);
    } catch {
      // ignore plugin list failures (non-critical)
    }
  }


  useEffect(() => {
    if (activeId) void refreshPluginRuns(activeId);
  }, [activeId]);

  async function runSelectedPlugin() {
    try {
      setError(null);
      setPluginBusy(true);
      setPluginResult(null);

      let cid = activeId;

      // If no conversation yet, create one automatically
      if (!cid) {
        const newId = await startNewChat();
        if (!newId) throw new Error("Failed to create conversation");
        cid = newId;
      }

      const args =
        pluginName === "summariseConversation"
          ? { conversationId: cid, limit: 30, saveAsMessage: false }
          : pluginName === "exportConversation"
            ? { conversationId: cid, limit: 200 }
            : {};


      const res = await executePlugin(cid, pluginName, args);
      if (!res.ok) throw new Error(res.error);

      setPluginResult(res.data);


      // If exportConversation returns text content, auto-download it for the user
      if (pluginName === "exportConversation") {
        const out = res.data?.output ?? res.data;

        const text = (() => {
          if (typeof out === "string") return out;

          if (out && typeof out === "object" && !Array.isArray(out)) {
            const o = out as Record<string, unknown>;
            if (typeof o.text === "string") return o.text;
            if (typeof o.markdown === "string") return o.markdown;
            if (typeof o.content === "string") return o.content;
          }

          return null;
        })();

        if (text) {
          const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);

          const a = document.createElement("a");
          const safeId = (cid || "conversation").slice(0, 8);
          a.href = url;
          a.download = `conversation-${safeId}.txt`;
          document.body.appendChild(a);
          a.click();
          a.remove();

          URL.revokeObjectURL(url);
        }
      }

      // summariseConversation can write a new assistant message -> refresh messages
      if (pluginName === "summariseConversation") {
        const m = await getMessages(cid);
        if (m.ok) setMessages(m.data.messages);
      }

      await refreshPluginRuns(cid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Plugin failed";
      setError(friendlyError(msg));
    } finally {
      setPluginBusy(false);
    }
  }

  async function handleRenameConversation(conversationId: string) {
    try {
      const current =
        conversations.find((c) => c.id === conversationId)?.title ??
        titles[conversationId] ??
        "";

      const nextRaw = prompt("Rename conversation:", current || "");
      if (nextRaw === null) return; // user cancelled prompt

      const next = nextRaw.trim();
      const title = next ? next : null;

      const ok = confirm(
        `Are you sure you want to rename this conversation to:\n\n${title ?? "(no title)"}`
      );
      if (!ok) return;

      const res = await renameConversation(conversationId, title);
      if (!res.ok) throw new Error(res.error);

      // update local cache + refresh list
      setTitles((prev) => ({ ...prev, [conversationId]: title ?? "" }));
      await refreshConversations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rename failed";
      setError(friendlyError(msg));
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      const ok = confirm("Are you sure you want to delete this conversation? This cannot be undone.");
      if (!ok) return;

      const res = await deleteConversation(conversationId);
      if (!res.ok) throw new Error(res.error);

      // remove from list
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      // if deleting active conversation, clear UI + URL
      if (activeId === conversationId) {
        setActiveId(null);
        setMessages([]);
        router.push(`/`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      setError(friendlyError(msg));
    }
  }

  async function openConversation(id: string) {
    const action = async () => {
      // If a stream is in progress, cancel it before switching chats
      if (streaming) cancelStreamSilently();

      try {
        setError(null);
        setLoading(true);
        setActiveId(id);
        setMessages([]);

        const res = await getMessages(id);
        if (!res.ok) throw new Error(res.error);

        setMessages(res.data.messages);
        const t = makeTitleFromMessages(res.data.messages);
        if (t) setTitles((prev) => ({ ...prev, [id]: t }));

      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setLoading(false);
      }
    };

    await action();
  }

  type StreamMeta = { llmMode?: string; model?: string; aiEnabled?: boolean };
  type StreamDone = { conversationId?: string };
  type StreamError = { error?: string; details?: string };
  type ToolEvent = {
    runId?: string;
    tool?: string;
    status?: "ok" | "error";
    error?: string | null;
  };

  async function readSseStream(
    res: Response,
    onDelta: (delta: string) => void,
    onDone: (data: StreamDone) => void,
    onMeta?: (data: StreamMeta) => void,
    onTool?: (data: ToolEvent) => void,
    signal?: AbortSignal,
  ) {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(text || res.statusText || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const cancel = async () => {
      try { await reader.cancel(); } catch { }
    };

    if (signal) {
      if (signal.aborted) {
        await cancel();
        return;
      }
      signal.addEventListener("abort", () => void cancel(), { once: true });
    }

    try {
      while (true) {
        if (signal?.aborted) return;

        const { value, done } = await reader.read();
        if (done) break;

        if (signal?.aborted) return;

        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          if (signal?.aborted) return;

          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          let event = "message";
          let dataStr = "";

          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }

          if (!dataStr) continue;

          const data = (() => {
            try {
              return JSON.parse(dataStr);
            } catch {
              return null;
            }
          })();

          if (event === "meta" && onMeta) onMeta((data || {}) as StreamMeta);
          if (event === "tool" && onTool) onTool((data || {}) as ToolEvent);
          if (event === "delta" && data?.delta) onDelta(String(data.delta));
          if (event === "done") onDone((data || {}) as StreamDone);

          if (event === "ping") continue;

          if (event === "error") {
            const err = (data || {}) as StreamError;
            throw new Error(err.details || err.error || "Stream error");
          }
        }
      }
    } finally {
      await cancel();
    }
  }
  // (removed) extractFirstFencedCode — unused (we use extractCodeBlocks + stripCodeBlocks instead)


  async function retryLastSend() {
    const payload = lastSendRef.current;
    if (!payload || !payload.text) return;
    wantsCodeRef.current = promptLooksLikeCodeRequest(payload.text);

    // show thinking + clear error
    setLoading(true);
    setError(null);

    const action = async () => {
      setStreaming(true);

      stoppedByUserRef.current = false;

      const assistantId =
        lastAssistantIdRef.current ?? globalThis.crypto.randomUUID();
      lastAssistantIdRef.current = assistantId;
      activeAssistantIdRef.current = assistantId;


      // Clear previous stopped content before retrying
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: "" }
            : msg,
        ),
      );


      setMessages((m) =>
        m.some((x) => x.id === assistantId)
          ? m
          : [...m, { id: assistantId, role: "assistant", content: "" }],
      );

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const cid = payload.conversationId ?? activeId ?? undefined;

      // keep lastSendRef up to date so future retries always have the cid
      lastSendRef.current = { text: payload.text, conversationId: cid };

      const looksLikeErrorReport =
        /\b(error|cannot call|undeclared|mismatched input|expected|type mismatch|problem)\b/i.test(payload.text);

      const hasExistingCode = !!codeText.trim();

      // If user is sending errors OR we already have code, force code-mode
      wantsCodeRef.current =
        wantsCodeRef.current || looksLikeErrorReport || hasExistingCode;

      const codeContext =
        hasExistingCode
          ? `\n\nEXISTING CODE (edit this, do NOT restart):\n\`\`\`pinescript\n${codeText}\n\`\`\`\n`
          : "";

      // removed: errorContext (unused)


      const finalText = wantsCodeRef.current
        ? `${PINE_RULES}

USER REQUEST:
${payload.text}${looksLikeErrorReport ? `

USER ERROR / COMPILER OUTPUT:
${payload.text}` : ""}${codeContext ? `

${codeContext}` : ""}`
        : payload.text;


      const res = await streamMessage(finalText, cid, controller.signal);


      let streamed = "";
      let sawDone = false;

      await readSseStream(
        res,
        (delta) => {
          streamed += delta;

          const extracted = extractCodeBlocks(streamed);

          // If we detect code, push it to the code canvas and OPEN the code panel.
          if (extracted) {
            setCodeText(extracted);
            setCodeOpen((v) => (v ? v : true));
          }

          // HARD RULE: if ANY code detected, chat shows ONLY the hint (no code, no mixed text)
          const hint = "[Code generated → open the Code panel]";
          const chatWithHint = extracted ? hint : stripCodeBlocks(streamed);

          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId ? { ...msg, content: chatWithHint } : msg,
            ),
          );

        },

        (doneData) => {
          sawDone = true;

          const finalCid = doneData?.conversationId || activeId || payload.conversationId || null;
          if (finalCid) void refreshPluginRuns(finalCid);
        },
        undefined,
        (toolEvt) => {
          setLastToolEvent(toolEvt || null);

          const cid = activeId || payload.conversationId || null;
          if (cid) void refreshPluginRuns(cid);
        },
        controller.signal,
      );

      setStreaming(false);
      // Successful retry completion -> nothing to retry
      // Disable retry only if stream actually completed (got done event)
      if (controller.signal.aborted || !sawDone) setCanRetry(true);
      else setCanRetry(false);

      activeAssistantIdRef.current = null;
      abortRef.current = null;
    };

    try {
      await action();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Retry failed";
      setError(friendlyError(msg));
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  }


  async function handleSend() {
    const text = input.trim();

    // Build OCR context (if screenshots attached)
    const ocrParts = attachments
      .map((a, i) => {
        const name = a.file?.name ? a.file.name : `image_${i + 1}`;
        const ocr = (a.ocrText ?? "").trim();
        if (!ocr) return null;
        return `--- ${name} ---\n${ocr}`;
      })
      .filter(Boolean)
      .join("\n\n");

    const screenshotContext =
      ocrParts.trim()
        ? `\n\n[SCREENSHOT OCR]\n${ocrParts.trim()}\n`
        : attachments.length > 0
          ? `\n\n[SCREENSHOT ATTACHED]\n${attachments.map((a) => a.file?.name || "image").join(", ")}\n`
          : "";

    // What the user sees vs what the API receives
    const uiText = text;
    const apiText = `${text}${screenshotContext}`.trim();

    // Determine if user intent requires code-mode (edit existing code OR request code)
    const hasExistingCode = !!codeText.trim();
    const wantsEdit = looksLikeEditRequest(apiText);

    wantsCodeRef.current = promptLooksLikeCodeRequest(apiText) || hasExistingCode || wantsEdit;

    if (!apiText || loading) return;

    lastSendRef.current = { text: apiText, conversationId: activeId ?? undefined };
    setCanRetry(true);

    setLoading(true);
    setError(null);

    // If this is the first message in this conversation, set a readable title
    if (activeId && !titles[activeId]) {
      const t = makeTitleFromText(text);
      if (t) setTitles((prev) => ({ ...prev, [activeId]: t }));
    }

    const userMsg: Msg = {
      id: globalThis.crypto.randomUUID(),
      role: "user",
      content: uiText,
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.file?.name || "image",
        url: a.url,
      })),
    };

    setMessages((m) => [...m, userMsg]);
    setInput("");

    // IMPORTANT: do NOT revoke URLs yet, because chat is now using them
    clearAttachments({ revokeUrls: false });

    const action = async () => {
      setStreaming(true);

      // Create a blank assistant message we stream into
      const assistantId = activeAssistantIdRef.current ?? globalThis.crypto.randomUUID();
      activeAssistantIdRef.current = assistantId;
      lastAssistantIdRef.current = assistantId;

      // only add the assistant bubble once
      setMessages((m) =>
        m.some((x) => x.id === assistantId)
          ? m
          : [...m, { id: assistantId, role: "assistant", content: "" }],
      );

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const payload = lastSendRef.current ?? { text: apiText, conversationId: activeId ?? undefined };


      const looksLikeErrorReport =
        /\b(error|cannot call|undeclared|mismatched input|expected|type mismatch|problem)\b/i.test(payload.text);

      const codeContext =
        codeText.trim()
          ? `\n\nEXISTING CODE (edit this, do NOT restart):\n\`\`\`pinescript\n${codeText}\n\`\`\`\n`
          : "";


      // removed: errorContext (unused)

      const finalText = wantsCodeRef.current
        ? `${PINE_RULES}

USER REQUEST:
${payload.text}${looksLikeErrorReport ? `

USER ERROR / COMPILER OUTPUT:
${payload.text}` : ""}${codeContext ? `

${codeContext}` : ""}`
        : payload.text;



      const res = await streamMessage(finalText, payload.conversationId, controller.signal);


      let streamed = "";
      let sawDone = false;


      await readSseStream(
        res,
        (delta) => {
          streamed += delta;

          const extracted = extractCodeBlocks(streamed);

          if (extracted) {
            setCodeText(extracted);

            if (wantsCodeRef.current) {
              setCodeOpen(true);
            }
          }

          const hint = "[Code generated → open the Code panel]";
          const chatWithHint = extracted ? hint : stripCodeBlocks(streamed);

          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId ? { ...msg, content: chatWithHint } : msg,
            ),
          );
        },
        (doneData) => {
          sawDone = true;

          // Always refresh runs for the final conversationId (new or existing)
          const finalCid = doneData?.conversationId || activeId || null;
          if (finalCid) void refreshPluginRuns(finalCid);

          const newConversationId = doneData?.conversationId;

          if (!activeId && newConversationId) {
            if (lastSendRef.current) {
              lastSendRef.current = {
                text: lastSendRef.current.text,
                conversationId: newConversationId,
              };
            }

            setActiveId(newConversationId);
            router.push(`/?c=${encodeURIComponent(newConversationId)}`);

            if (!titles[newConversationId]) {
              const firstText = lastSendRef.current?.text ?? "";
              const t = makeTitleFromText(firstText);
              if (t) setTitles((prev) => ({ ...prev, [newConversationId]: t }));
            }

            setConversations((prev) => {
              const exists = prev.some((c) => c.id === newConversationId);
              if (exists) return prev;
              return [{ id: newConversationId, updated_at: new Date().toISOString() }, ...prev];
            });

            void refreshConversations();
            void refreshPluginRuns(newConversationId);
          }
        },
        undefined,
        (toolEvt) => {
          // capture + refresh plugin runs immediately when tool fires
          setLastToolEvent(toolEvt || null);

          const cid = activeId || payload.conversationId || null;
          if (cid) void refreshPluginRuns(cid);
        },
        controller.signal,
      );


      setStreaming(false);
      // If we stopped (abort) or never saw "done", allow retry; otherwise disable it
      setCanRetry(stoppedByUserRef.current || controller.signal.aborted || !sawDone);


      activeAssistantIdRef.current = null;

      abortRef.current = null;
    };


    try {
      await action();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "⚠️ Failed to get a reply. Is the API running?";
      setError(friendlyError(msg));
      setMessages((m) => [
        ...m,
        { id: globalThis.crypto.randomUUID(), role: "assistant", content: `⚠️ ${friendlyError(msg)}` },
      ]);
    } finally {
      setLoading(false);
      setStreaming(false);
    }

  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <>
          <aside
            className="border-r p-4 overflow-y-auto shrink-0"
            style={{ width: sidebarWidth }}
          >
            <div className="flex items-center justify-between mb-3 pb-3 border-b">
              <div className="flex items-center gap-2">
                <Image
                  src="/t4n-logo.png"
                  alt="T4N"
                  width={24}
                  height={24}
                  className="h-6 w-6 object-contain"
                />

                <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Conversations
                </div>
              </div>

              <button
                type="button"
                className="rounded border px-3 py-1 text-sm bg-white hover:bg-gray-100 shadow-sm leading-none"
                onClick={() => {
                  // removed: startNewChat() will navigate to the new ?c=...
                  void startNewChat();
                }}
              >
                New
              </button>
            </div>

            <div className="mb-3">
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="Search conversations…"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
              />
            </div>

            <ul className="space-y-1 text-sm">
              {conversations.length === 0 ? (
                <li className="text-gray-400">No conversations yet</li>
              ) : (
                filteredConversations.map((c) => (
                  <li
                    key={c.id}
                    className={`cursor-pointer select-none rounded px-2 py-1 hover:bg-gray-100 ${activeId === c.id ? "bg-gray-200 font-medium" : ""
                      }`}
                    onClick={() => {
                      router.push(`/?c=${encodeURIComponent(c.id)}`);
                      void openConversation(c.id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 group">
                      <span className="truncate">
                        {titles[c.id] ?? c.title ?? c.id.slice(0, 8)}
                      </span>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Hover-only actions */}
                        <div className="hidden group-hover:flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-[11px] bg-white hover:bg-gray-100"
                            title="Rename"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleRenameConversation(c.id);
                            }}
                          >
                            ✏️
                          </button>

                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-[11px] bg-white hover:bg-gray-100"
                            title="Delete"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleDeleteConversation(c.id);
                            }}
                          >
                            🗑️
                          </button>
                        </div>

                        <span className="text-[10px] opacity-50">
                          {new Date(c.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </aside>

          {/* drag handle between sidebar and chat */}
          <div
            className="w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
            onPointerDown={() => {
              draggingRef.current = "sidebar";
            }}
            title="Drag to resize conversations"
          />
        </>
      )}

      <main className="flex-1 flex flex-col">
        <div className="border-b p-3 text-sm flex items-center gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1 hover:bg-gray-100"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide conversations" : "Show conversations"}
          >
            {sidebarOpen ? "Hide" : "Conversations"}
          </button>

          <button
            type="button"
            className="rounded border px-3 py-1 hover:bg-gray-100"
            onClick={() => setPluginsOpen(true)}
          >
            Plugins
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1 hover:bg-gray-100"
              onClick={() => setCodeOpen((v) => !v)}
              title="Toggle code panel"
            >
              Code
            </button>

            {activeId && (
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => void refreshPluginRuns(activeId)}
              >
                Refresh runs
              </button>
            )}
          </div>
        </div>

        {pluginsOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
            onMouseDown={() => setPluginsOpen(false)}
          >
            <div
              className="w-[780px] max-w-[95vw] rounded-lg bg-white shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b p-3">
                <div className="font-semibold flex items-center gap-2">
                  Plugins
                  {lastToolEvent?.tool ? (
                    <span className="text-[11px] px-2 py-0.5 rounded border bg-gray-50">
                      tool: <span className="font-mono">{lastToolEvent.tool}</span> • {lastToolEvent.status}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="rounded border px-3 py-1 hover:bg-gray-100"
                  onClick={() => setPluginsOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="p-3 text-sm flex items-center gap-2">
                <select
                  className="border rounded px-2 py-1"
                  value={pluginName}
                  onChange={(e) =>
                    setPluginName(
                      e.target.value as
                      | "healthcheck"
                      | "summariseConversation"
                      | "exportConversation",
                    )
                  }
                  disabled={pluginBusy}
                >
                  <option value="healthcheck">healthcheck</option>
                  <option value="summariseConversation">summariseConversation</option>
                  <option value="exportConversation">exportConversation</option>
                </select>

                <button
                  type="button"
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  onClick={() => void runSelectedPlugin()}
                  disabled={pluginBusy}
                  title={!activeId ? "No conversation selected — will create one automatically" : ""}
                >
                  {pluginBusy ? "Running…" : "Run"}
                </button>

              </div>
              {(pluginResult || pluginRuns.length > 0) && (
                <div className="border-t p-3 text-xs bg-gray-50 space-y-2">
                  {!!pluginResult && (
                    <div>
                      <div className="font-medium mb-1">Last plugin result</div>

                      {(() => {
                        const pr = pluginResult;

                        const asObj =
                          pr && typeof pr === "object" && !Array.isArray(pr)
                            ? (pr as Record<string, unknown>)
                            : null;

                        const plugin = String(asObj?.plugin ?? "");
                        const status = String(asObj?.status ?? "");
                        const runId = String(asObj?.runId ?? "");
                        const cid = String(asObj?.conversationId ?? activeId ?? "");

                        const output = asObj && "output" in asObj ? (asObj.output as unknown) : null;

                        if (plugin === "healthcheck") {
                          // Minimal + safe UI: no model / llmMode exposure
                          const ok =
                            (asObj && "ok" in asObj && (asObj as Record<string, unknown>).ok === true) ||
                            (output && typeof output === "object" && output !== null && "ok" in (output as Record<string, unknown>) && (output as Record<string, unknown>).ok === true);

                          return (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="opacity-70">
                                  <span className="font-mono">healthcheck</span>
                                  {runId ? <span className="opacity-60"> • {runId.slice(0, 8)}</span> : null}
                                </div>

                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] font-medium border ${ok ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-800 border-yellow-200"
                                    }`}
                                >
                                  {ok ? "OK" : "UNKNOWN"}
                                </span>
                              </div>

                              <pre className="whitespace-pre-wrap break-words bg-white border rounded p-2 overflow-auto max-h-64">
                                {JSON.stringify({ ok }, null, 2)}
                              </pre>
                            </div>
                          );
                        }


                        if (plugin === "exportConversation") {
                          const transcript = (() => {
                            if (typeof output === "string") return output;

                            if (output && typeof output === "object" && !Array.isArray(output)) {
                              const o = output as Record<string, unknown>;
                              if (typeof o.transcript === "string") return o.transcript;
                            }

                            return JSON.stringify(output, null, 2);
                          })();

                          const filename = cid ? `conversation-${cid.slice(0, 8)}.md` : "conversation.md";

                          return (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="opacity-70">
                                  <span className="font-mono">{plugin}</span>
                                  {runId ? <span className="opacity-60"> • {runId.slice(0, 8)}</span> : null}
                                  {status ? <span className="opacity-60"> • {status}</span> : null}
                                </div>

                                <button
                                  type="button"
                                  className="rounded border px-3 py-1"
                                  onClick={() => downloadTextFile(filename, transcript)}
                                >
                                  Download .md
                                </button>
                              </div>

                              <pre className="whitespace-pre-wrap break-words bg-white border rounded p-2 overflow-auto max-h-64">
                                {transcript}
                              </pre>
                            </div>
                          );
                        }

                        if (plugin === "summariseConversation") {
                          const summary = (() => {
                            if (typeof output === "string") return output;

                            if (output && typeof output === "object" && !Array.isArray(output)) {
                              const o = output as Record<string, unknown>;
                              if (typeof o.summary === "string") return o.summary;
                            }

                            return JSON.stringify(output, null, 2);
                          })();

                          return (
                            <div className="space-y-2">
                              <div className="opacity-70">
                                <span className="font-mono">{plugin}</span>
                                {runId ? <span className="opacity-60"> • {runId.slice(0, 8)}</span> : null}
                                {status ? <span className="opacity-60"> • {status}</span> : null}
                              </div>
                              <pre className="whitespace-pre-wrap break-words bg-white border rounded p-2 overflow-auto max-h-64">
                                {summary}
                              </pre>
                            </div>
                          );
                        }

                        return (
                          <pre className="whitespace-pre-wrap break-words bg-white border rounded p-2 overflow-auto max-h-64">
                            {JSON.stringify(pluginResult, null, 2)}
                          </pre>
                        );
                      })()}
                    </div>
                  )}

                  {pluginRuns.length > 0 && (
                    <div>
                      <div className="font-medium mb-1">Recent plugin runs</div>
                      <div className="space-y-1">
                        {pluginRuns.slice(0, 5).map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2">
                            <div className="truncate">
                              <span className="font-mono">{r.pluginName}</span>
                              <span className="opacity-60"> — {r.status}</span>
                              {r.error ? <span className="text-red-700"> — {r.error}</span> : null}
                            </div>
                            <div className="opacity-60">{r.createdAt}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="border-b p-3 text-sm bg-red-50">
            <div className="font-medium">Request failed</div>
            <div className="opacity-80">{error}</div>

            <button
              className="mt-2 rounded border px-3 py-1"
              onClick={() => {
                cancelStreamSilently();
                void retryLastSend();
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Chat area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 relative">
            <Image
              src="/t4n-logo.png"
              alt=""
              width={256}
              height={256}
              className="pointer-events-none select-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 opacity-[0.1]"
              priority={false}
            />

            {loading && <div className="text-xs opacity-60">Thinking…</div>}

            {messages.length === 0 && (
              <div className="text-gray-400 flex items-center justify-center h-full">
                {activeId ? "No messages yet" : "Start a new chat below"}
              </div>
            )}

            {messages.map((m) => {
              const isUser = m.role === "user";
              const isStopped = !isUser && /\[Stopped\]\s*$/.test(m.content || "");
              const cleanText = isStopped
                ? (m.content || "").replace(/\n?\n?\[Stopped\]\s*$/, "")
                : (m.content || "");

              const isActiveStreaming = !isUser && streaming && m.id === activeAssistantIdRef.current;

              return (
                <div key={m.id} className={`max-w-xl ${isUser ? "ml-auto text-right" : ""}`}>
                  <div
                    className={`rounded p-2 whitespace-pre-wrap break-words ${isUser
                      ? "bg-blue-500 text-white"
                      : isStopped
                        ? "bg-yellow-50 border border-yellow-300"
                        : "bg-gray-100"
                      }`}
                  >
                    {!isUser && isStopped && (
                      <div className="mb-1 text-xs font-medium opacity-70">Stopped</div>
                    )}
                    {cleanText}

                    {!!m.attachments?.length && (
                      <div className={`mt-2 flex flex-wrap gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                        {m.attachments.map((a) => (
                          <div key={a.id} className="border rounded bg-white overflow-hidden">
                            <Image
                              src={a.url}
                              alt={a.name}
                              width={220}
                              height={140}
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {isActiveStreaming ? " ▍" : ""}

                  </div>
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>

          {/* Code panel */}
          {codeOpen && (
            <div
              className="w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
              onPointerDown={() => {
                draggingRef.current = "code";
              }}
              title="Drag to resize code panel"
            />
          )}

          {codeOpen && (
            <aside
              className="max-w-[45vw] border-l bg-white flex flex-col shrink-0"
              style={{ width: codeWidth }}
            >
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                    onClick={saveCurrentCode}
                    disabled={!codeText.trim()}
                    title="Save current code"
                  >
                    Save
                  </button>

                  <button
                    type="button"
                    className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(codeText || "");
                      } catch {
                        // ignore
                      }
                    }}
                    disabled={!codeText.trim()}
                    title="Copy code to clipboard"
                  >
                    Copy
                  </button>


                  {activeCodeId && (
                    <button
                      type="button"
                      className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                      onClick={updateActiveSnippet}
                      disabled={!codeText.trim()}
                      title="Overwrite selected snippet"
                    >
                      Update
                    </button>
                  )}


                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={activeCodeId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setActiveCodeId(id);
                      const found = savedCodes.find((s) => s.id === id);
                      if (found) setCodeText(found.code);
                    }}
                  >
                    <option value="">Saved snippets…</option>
                    {savedCodes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>

                  {activeCodeId && (
                    <>
                      <button
                        type="button"
                        className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                        onClick={() => {
                          if (!activeCodeId) return;
                          renameSnippet(activeCodeId);
                        }}
                      >
                        Rename
                      </button>


                      <button
                        type="button"
                        className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                        onClick={() => {
                          if (!activeCodeId) return;
                          deleteSnippet(activeCodeId);
                        }}
                      >
                        Delete
                      </button>

                    </>
                  )}
                </div>

                <div className="font-semibold text-sm">Code</div>
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
                  onClick={() => setCodeOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="p-3 overflow-y-auto">
                {codeText ? (
                  <textarea
                    className="w-full h-[70vh] whitespace-pre font-mono break-words bg-gray-50 border rounded p-2 text-xs overflow-auto"
                    value={codeText}
                    onChange={(e) => setCodeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const el = e.currentTarget;
                        const start = el.selectionStart ?? 0;
                        const end = el.selectionEnd ?? 0;
                        const insert = "  "; // 2 spaces
                        const next = codeText.slice(0, start) + insert + codeText.slice(end);
                        setCodeText(next);
                        requestAnimationFrame(() => {
                          el.selectionStart = el.selectionEnd = start + insert.length;
                        });
                      }
                    }}
                  />

                ) : (
                  <div className="text-sm text-gray-500">
                    No code detected yet. Ask for code or wait for a ``` block to appear.
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>


        {/* ALWAYS SHOW COMPOSER */}
        <form
          className="border-t p-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <div className="flex-1 flex flex-col gap-2">
            {attachments.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 border rounded p-1 bg-white">
                    {/* thumbnail */}
                    <Image
                      src={a.url}
                      alt={a.file?.name || "attachment"}
                      width={40}
                      height={40}
                      className="h-10 w-10 object-cover rounded"
                      unoptimized
                    />

                    <div className="text-[11px] leading-tight max-w-[220px]">
                      <div className="truncate">{a.file?.name || "image"}</div>
                      <div className="opacity-60">
                        {ocrBusy ? "OCR…" : (a.ocrText ?? "").trim() ? "OCR ready" : "No OCR"}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-100"
                      onClick={() => removeAttachment(a.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={inputRef}
              className="w-full border rounded px-3 py-2"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.items ?? []);
                const files = items
                  .map((it) => (it.kind === "file" ? it.getAsFile() : null))
                  .filter((f): f is File => !!f && f.type.startsWith("image/"));

                if (files.length > 0) {
                  e.preventDefault(); // prevent weird “[object Object]” paste
                  void handleAttachArray(files);
                }
              }}
              disabled={loading}
            />
          </div>

          {streaming ? (
            <button
              type="button"
              className="bg-black text-white px-4 rounded"
              onClick={stopStreaming}
            >
              Stop
            </button>
          ) : (
            <>
              <label className="rounded border px-4 py-2 cursor-pointer select-none hover:bg-gray-100">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleAttachFiles(e.target.files);
                    // allow attaching the same file again later
                    e.currentTarget.value = "";
                  }}
                  disabled={loading}
                />
                Attach
              </label>

              <button
                type="button"
                className="rounded border px-4 disabled:opacity-50"
                disabled={loading || !canRetry}
                onClick={() => {
                  cancelStreamSilently();
                  void retryLastSend();
                }}
                title={!canRetry ? "Nothing to retry yet" : "Retry last message"}
              >
                Retry
              </button>

              <button
                className="bg-black text-white px-4 rounded disabled:opacity-50"
                disabled={loading}
              >
                Send
              </button>
            </>

          )}
        </form>
      </main>
    </div>
  );
}
