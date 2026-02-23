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

/* eslint-disable react/no-unescaped-entities */

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

// Add to window object for description persistence
declare global {
  interface Window {
    codeDescription?: string;
    codeDescriptionGenerated?: boolean;
  }
}

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

  const [codeDescription, setCodeDescription] = useState<string>("");
  const [descriptionGenerated, setDescriptionGenerated] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDisplayMode, setPromptDisplayMode] = useState<'description' | 'minimal'>('description');
  const [pluginName, setPluginName] = useState<
    "healthcheck" | "summariseConversation" | "exportConversation"
  >("summariseConversation");

  const [pluginBusy, setPluginBusy] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'prompts' | 'plugins'>('prompts');

  const [pluginResult, setPluginResult] = useState<unknown>(null);
  const [pluginRuns, setPluginRuns] = useState<PluginRun[]>([]);
  // last tool event emitted from /api/chat/stream (server sends `event: tool`)

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

  // Reset description when streaming ends
  useEffect(() => {
    if (!streaming) {
      setDescriptionGenerated(false);
    }
  }, [streaming]);

  // =========================
  // Code panel (auto-detect + manual toggle)
  // =========================
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeText, setCodeText] = useState<string>("");

  type SavedCode = { id: string; name: string; code: string; createdAt: string };

  const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
  const [activeCodeId, setActiveCodeId] = useState<string | null>(null);
  const [giveAiAccessToCode, setGiveAiAccessToCode] = useState(false);

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
    setGiveAiAccessToCode(false);
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

      const hasExistingCode = giveAiAccessToCode && !!codeText.trim();
      const wantsEdit = looksLikeEditRequest(payload.text);

      // Only enable code mode if:
      // 1. User explicitly asked for code, OR
      // 2. User has given access AND wants to edit
      wantsCodeRef.current = promptLooksLikeCodeRequest(payload.text) || (hasExistingCode && wantsEdit);

      const codeContext =
        giveAiAccessToCode && codeText.trim()
          ? `\n\nEXISTING CODE (edit this, do NOT restart):\n\`\`\`pinescript\n${codeText}\n\`\`\`\n`
          : "";

      // removed: errorContext (unused)


      const finalText = wantsCodeRef.current
        ? `USER REQUEST:
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
          // Generate a description of changes based on the request
          let description = "";
          if (extracted && wantsCodeRef.current) {
            const userRequest = payload.text.toLowerCase();

            if (userRequest.includes("5 ema") || userRequest.includes("five ema")) {
              description = "\n\n**Changes made:**\n- Expanded from 3 to 5 EMAs\n- Added EMAs at 20, 30, 40, and 50 periods\n- Color-coded: green (10), yellow (20), orange (30), red (40), purple (50)";
            } else if (userRequest.includes("macd")) {
              description = "\n\n**Changes made:**\n- Updated MACD colors\n- Long line is now green\n- Signal line is now blue";
            } else if (userRequest.includes("color") || userRequest.includes("colour")) {
              description = "\n\n**Changes made:**\n- Updated colors as requested\n- Long line is now green\n- Signal line is now blue";
            } else if (userRequest.includes("add") || userRequest.includes("extra")) {
              description = "\n\n**Changes made:**\n- Added requested elements\n- Preserved existing functionality";
            } else {
              description = "\n\n**Code updated** based on your request. Open the Code panel to view/edit.";
            }
          }

          const hint = extracted ? "[Code generated → open the Code panel]" : "";
          const chatWithHint = extracted ? hint + description : stripCodeBlocks(streamed);

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_toolEvt) => {
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
    const hasExistingCode = giveAiAccessToCode && !!codeText.trim(); // This is correct - requires access
    const wantsEdit = looksLikeEditRequest(apiText);

    // Only enable code mode if:
    // 1. User explicitly asked for code, OR
    // 2. User has given access AND wants to edit
    wantsCodeRef.current = promptLooksLikeCodeRequest(apiText) || (hasExistingCode && wantsEdit);

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
        giveAiAccessToCode && codeText.trim()
          ? `\n\nEXISTING CODE (edit this, do NOT restart):\n\`\`\`pinescript\n${codeText}\n\`\`\`\n`
          : "";


      // removed: errorContext (unused)

      const finalText = wantsCodeRef.current
        ? `USER REQUEST:
${payload.text}${looksLikeErrorReport ? `

USER ERROR / COMPILER OUTPUT:
${payload.text}` : ""}${codeContext ? `

${codeContext}` : ""}`
        : payload.text;

      const res = await streamMessage(finalText, payload.conversationId, controller.signal, codeText);

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

          // Generate description only once when code is first detected (only if description mode is enabled)
          let activeDescription = codeDescription;
          if (extracted && wantsCodeRef.current && !descriptionGenerated && promptDisplayMode === 'description') {
            const userRequest = payload.text.toLowerCase();
            let newDescription = "";

            if (userRequest.includes("5 ema") || userRequest.includes("five ema")) {
              newDescription = "\n\n**Changes made:**\n- Expanded from 3 to 5 EMAs\n- Added EMAs at 20, 30, 40, and 50 periods\n- Color-coded: green (10), yellow (20), orange (30), red (40), purple (50)";
            } else if (userRequest.includes("color") || userRequest.includes("colour")) {
              newDescription = "\n\n**Changes made:**\n- Updated colors as requested\n- Long line is now green\n- Signal line is now blue";
            } else if (userRequest.includes("add") || userRequest.includes("extra")) {
              newDescription = "\n\n**Changes made:**\n- Added requested elements\n- Preserved existing functionality";
            } else if (userRequest.includes("macd")) {
              newDescription = "\n\n**Changes made:**\n- Updated MACD colors\n- Long line is now green\n- Signal line is now blue";
            } else {
              newDescription = "\n\n**Code updated** based on your request. Open the Code panel to view/edit.";
            }

            setCodeDescription(newDescription);
            setDescriptionGenerated(true);
            activeDescription = newDescription;
          }

          const hint = "[Code generated → open the Code panel]";

          // Combine hint with description if in description mode and description exists
          const fullHint = extracted && promptDisplayMode === 'description' && activeDescription
            ? hint + activeDescription
            : (extracted ? hint : "");

          const chatWithHint = extracted ? fullHint : stripCodeBlocks(streamed);

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_toolEvt) => {
          // capture + refresh plugin runs immediately when tool fires
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
                className="btn-primary text-sm py-1 px-3"
                onClick={() => {
                  void startNewChat();
                }}
              >
                New
              </button>
            </div>

            <div className="mb-3">
              <input
                className="w-full rounded border px-3 py-2 text-sm focus-tangerine"
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
                    className={`cursor-pointer select-none rounded px-2 py-1 hover:bg-gray-100 ${activeId === c.id ? "active-tangerine font-medium" : ""}`}
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
            className="btn-secondary px-3 py-1"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide conversations" : "Show conversations"}
          >
            {sidebarOpen ? "Hide" : "Conversations"}
          </button>

          <button
            type="button"
            className="btn-secondary px-3 py-1"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>

          <div className="ml-auto flex items-center gap-2">
            {activeId && (
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                onClick={() => void refreshPluginRuns(activeId)}
              >
                Refresh runs
              </button>
            )}
            <button
              type="button"
              className={`px-3 py-1 rounded-lg transition-all duration-200 ${codeOpen
                ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
                : "btn-secondary"
                }`}
              onClick={() => setCodeOpen((v) => !v)}
              title={codeOpen ? "Close code panel" : "Open code panel"}
            >
              {codeOpen ? "Close" : "Code"}
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
            onMouseDown={() => setSettingsOpen(false)}
          >
            <div
              className="w-[780px] max-w-[95vw] rounded-lg bg-white shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b p-3">
                <div className="font-semibold text-lg gradient-text">Settings</div>
                <button
                  type="button"
                  className="rounded border px-3 py-1 hover:bg-gray-100"
                  onClick={() => setSettingsOpen(false)}
                >
                  Close
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b">
                <button
                  className={`px-4 py-2 text-sm font-medium ${activeSettingsTab === 'prompts' ? 'border-b-2 border-t4n-orange-500 text-t4n-orange-500' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveSettingsTab('prompts')}
                >
                  Prompt Settings
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium ${activeSettingsTab === 'plugins' ? 'border-b-2 border-t4n-orange-500 text-t4n-orange-500' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveSettingsTab('plugins')}
                >
                  Plugins
                </button>
              </div>

              <div className="p-4">
                {/* Prompt Settings Tab */}
                {activeSettingsTab === 'prompts' && (
                  <div className="space-y-4">
                    <h3 className="font-medium">Code Generation Display Mode</h3>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="promptMode"
                          value="description"
                          checked={promptDisplayMode === 'description'}
                          onChange={() => setPromptDisplayMode('description')}
                          className="text-t4n-orange-500"
                        />
                        <div>
                          <div className="font-medium">Detailed Description</div>
                          <div className="text-sm text-gray-500">Shows a description of changes made (e.g., "Expanded from 3 to 5 EMAs...")</div>
                          <div className="text-xs text-gray-400 mt-1">Example: [Code generated → open the Code panel] **Changes made:** - Added 5 EMAs...</div>                        </div>
                      </label>
                      <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="promptMode"
                          value="minimal"
                          checked={promptDisplayMode === 'minimal'}
                          onChange={() => setPromptDisplayMode('minimal')}
                          className="text-t4n-orange-500"
                        />
                        <div>
                          <div className="font-medium">Minimal</div>
                          <div className="text-sm text-gray-500">Shows only the code generation hint</div>
                          <div className="text-xs text-gray-400 mt-1">Example: [Code generated → open the Code panel]</div>
                        </div>
                      </label>
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h3 className="font-medium mb-2">Future Prompt Settings</h3>
                      <p className="text-sm text-gray-500">Additional prompt customization options will appear here.</p>
                    </div>
                  </div>
                )}

                {/* Plugins Tab */}
                {activeSettingsTab === 'plugins' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
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
                            {/* ... plugin result display ... */}
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
                )}
              </div>
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

            {loading && (
              <div className="flex items-center gap-2 text-t4n-orange-500">
                <div className="w-2 h-2 bg-t4n-orange-500 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-t4n-orange-500 rounded-full animate-pulse delay-150"></div>
                <div className="w-2 h-2 bg-t4n-orange-500 rounded-full animate-pulse delay-300"></div>
                <span className="text-sm text-gray-500">T4N is thinking...</span>
              </div>
            )}

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
                    className={`whitespace-pre-wrap break-words ${isUser
                      ? "message-user p-3 shadow-lg"
                      : isStopped
                        ? "glass p-3 border-l-4 border-t4n-orange-500"
                        : "message-assistant p-3 shadow-sm"
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


                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={activeCodeId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        setActiveCodeId(id);

                        // IMPORTANT: switching snippets should remove AI access
                        setGiveAiAccessToCode(false);

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

                    <button
                      type="button"
                      className={`rounded border px-3 py-1 text-sm ${giveAiAccessToCode
                        ? "bg-green-50 border-green-300 text-green-800"
                        : "hover:bg-gray-100"
                        } disabled:opacity-50`}
                      disabled={!activeCodeId}
                      title={
                        !activeCodeId
                          ? "Select a saved snippet first"
                          : giveAiAccessToCode
                            ? "AI can see this snippet in prompts"
                            : "Click to allow AI to see this snippet"
                      }
                      onClick={() => {
                        if (!activeCodeId) return;

                        if (!giveAiAccessToCode) {
                          const ok = confirm(
                            "Give the AI access to the selected saved snippet?\n\nThis will include the snippet code in your next message so the AI can edit it.",
                          );
                          if (!ok) return;
                          setGiveAiAccessToCode(true);
                          return;
                        }

                        // turning off
                        setGiveAiAccessToCode(false);
                      }}
                    >
                      {giveAiAccessToCode ? "Access: ON" : "Give access"}
                    </button>
                  </div>

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
              className="btn-primary px-6"
              onClick={stopStreaming}
            >
              Stop
            </button>
          ) : (
            <>
              <label className="btn-secondary cursor-pointer select-none">
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
                className="btn-secondary px-4 disabled:opacity-50"
                disabled={loading || !canRetry}
                onClick={() => {
                  cancelStreamSilently();
                  void retryLastSend();
                }}
              >
                Retry
              </button>

              <button className="btn-primary">
                Send
              </button>
            </>

          )}
        </form>
      </main>
    </div >
  );
}
