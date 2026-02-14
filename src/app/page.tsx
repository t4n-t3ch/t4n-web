"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  listConversations,
  getMessages,
  createConversation,
  streamMessage,
  executePlugin,
  getPluginRuns,
} from "@/lib/api";


type Conversation = { id: string; updated_at: string };
type Msg = { id: string; role: string; content: string };
type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };
type ApiResult<T> = ApiOk<T> | ApiErr;

type PluginRun = {
  id: string;
  pluginName: string;
  input: unknown;
  output: unknown;
  status: "ok" | "error";
  error?: string | null;
  createdAt: string;
};

type PluginRunsResponse = { runs: PluginRun[] };

type ExecutePluginResponse = {
  ok: boolean;
  runId: string;
  conversationId: string;
  plugin: string;
  output: unknown;
  requestId: string;
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
  const abortRef = useRef<AbortController | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolBanner, setToolBanner] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);

  const [pluginName, setPluginName] = useState<"healthcheck" | "summariseConversation">(
    "summariseConversation",
  );
  const [pluginBusy, setPluginBusy] = useState(false);

  const [pluginResult, setPluginResult] = useState<unknown>(null);
  const [pluginRuns, setPluginRuns] = useState<PluginRun[]>([]);

  const activeAssistantIdRef = useRef<string | null>(null);

  function stopStreaming() {
    abortRef.current?.abort();
    abortRef.current = null;

    // Optional UX: mark the current assistant message as stopped
    const aid = activeAssistantIdRef.current;
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
    activeAssistantIdRef.current = null;

    setLoading(false);
    activeAssistantIdRef.current = null;

  }

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      if (res.ok) setConversations(res.data.conversations);
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    }
  }

  useEffect(() => {
    void refreshConversations();
  }, []);

  async function startNewChat(): Promise<string | null> {
    let createdId: string | null = null;

    const action = async () => {
      try {
        setError(null);
        setLoading(true);
        setToolBanner(null); // reset “Tool used …” banner for this send


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

    setLastAction(() => action);
    await action();
    return createdId;
  }

  async function refreshPluginRuns(conversationId: string) {
    try {
      const res = (await getPluginRuns(conversationId, 25)) as ApiResult<PluginRunsResponse>;
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
          ? { conversationId: cid, limit: 30, saveAsMessage: true }
          : {};

      const res = (await executePlugin(cid, pluginName, args)) as ApiResult<ExecutePluginResponse>;
      if (!res.ok) throw new Error(res.error);

      setPluginResult(res.data);


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


  async function openConversation(id: string) {
    const action = async () => {
      try {
        setError(null);
        setLoading(true);
        setActiveId(id);
        setMessages([]);

        const res = await getMessages(id);
        if (!res.ok) throw new Error(res.error);

        setMessages(res.data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setLoading(false);
      }
    };

    setLastAction(() => action);
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



  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);

    const userMsg: Msg = {
      id: globalThis.crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((m) => [...m, userMsg]);
    setInput("");

    const action = async () => {
      setStreaming(true);

      // Create a blank assistant message we stream into
      const assistantId = globalThis.crypto.randomUUID();
      activeAssistantIdRef.current = assistantId;
      setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await streamMessage(text, activeId ?? undefined, controller.signal);

      let streamed = "";

      await readSseStream(
        res,
        (delta) => {
          streamed += delta;
          setMessages((m) =>
            m.map((msg) => (msg.id === assistantId ? { ...msg, content: streamed } : msg)),
          );
        },
        (doneData) => {
          const newConversationId = doneData?.conversationId;

          // Existing convo: refresh runs at end of stream too
          if (activeId) void refreshPluginRuns(activeId);

          // If this was the first message of a brand new chat, adopt the server-provided conversationId
          if (!activeId && newConversationId) {
            setActiveId(newConversationId);
            router.push(`/?c=${encodeURIComponent(newConversationId)}`);

            setConversations((prev) => {
              const exists = prev.some((c) => c.id === newConversationId);
              if (exists) return prev;
              return [{ id: newConversationId, updated_at: new Date().toISOString() }, ...prev];
            });

            void refreshConversations();
            void refreshPluginRuns(newConversationId);
          }
        },
        (meta) => {
          const mode = meta?.llmMode ?? "unknown";
          const model = meta?.model ?? "unknown";
          const enabled = meta?.aiEnabled === false ? "AI disabled" : "AI enabled";
          setToolBanner(`Meta: ${enabled} • mode=${mode} • model=${model}`);
        },
        (tool) => {
          const status = tool?.status ?? "ok";
          const name = tool?.tool ?? "tool";
          const runId = tool?.runId ? ` (${tool.runId})` : "";
          const err = tool?.error ? ` — ${tool.error}` : "";
          setToolBanner(`Tool used: ${name}${runId} • ${status}${err}`);
        },
        controller.signal,
      );




      setStreaming(false);
      abortRef.current = null;
    };


    setLastAction(() => action);

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
    <div className="flex h-screen">
      <aside className="w-64 border-r p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">Conversations</h2>
          <button
            onClick={() => {
              // removed: startNewChat() will navigate to the new ?c=...
              void startNewChat();
            }}

          >
            New
          </button>
        </div>

        <ul className="space-y-2 text-sm">
          {conversations.length === 0 ? (
            <li className="text-gray-400">No conversations yet</li>
          ) : (
            conversations.map((c) => (
              <li
                key={c.id}
                onClick={() => {
                  router.push(`/?c=${encodeURIComponent(c.id)}`);
                  void openConversation(c.id);
                }}

              >
                {c.id.slice(0, 8)}
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="border-b p-3 text-sm flex items-center gap-2">
          <div className="font-medium">Plugins</div>

          <select
            className="border rounded px-2 py-1"
            value={pluginName}
            onChange={(e) =>
              setPluginName(e.target.value as "healthcheck" | "summariseConversation")
            }
            disabled={pluginBusy}
          >
            <option value="healthcheck">healthcheck</option>
            <option value="summariseConversation">summariseConversation</option>
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

          <div className="ml-auto flex items-center gap-2">
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

        {(pluginResult || pluginRuns.length > 0) && (
          <div className="border-b p-3 text-xs bg-gray-50 space-y-2">
            {!!pluginResult && (

              <div>
                <div className="font-medium mb-1">Last plugin result</div>
                <pre className="whitespace-pre-wrap break-words bg-white border rounded p-2 overflow-auto">
                  {JSON.stringify(pluginResult, null, 2)}
                </pre>
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

        {toolBanner && (
          <div className="border-b p-3 text-sm bg-blue-50">
            <div className="font-medium">Tool call</div>
            <div className="opacity-80">{toolBanner}</div>
          </div>
        )}


        {error && (
          <div className="border-b p-3 text-sm bg-red-50">
            <div className="font-medium">Request failed</div>
            <div className="opacity-80">{error}</div>
            {lastAction && (
              <button className="mt-2 rounded border px-3 py-1" onClick={() => void lastAction()}>
                Retry
              </button>
            )}
          </div>
        )}

        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {loading && <div className="text-xs opacity-60">Thinking…</div>}

          {messages.length === 0 && (
            <div className="text-gray-400 flex items-center justify-center h-full">
              {activeId ? "No messages yet" : "Start a new chat below"}
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`max-w-xl ${m.role === "user" ? "ml-auto text-right" : ""}`}>
              <div
                className={`rounded p-2 ${m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
                  }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* ALWAYS SHOW COMPOSER */}
        <form
          className="border-t p-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <input
            ref={inputRef}
            className="flex-1 border rounded px-3 py-2"
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          {streaming ? (
            <button
              type="button"
              className="bg-black text-white px-4 rounded"
              onClick={stopStreaming}
            >
              Stop
            </button>
          ) : (
            <button
              className="bg-black text-white px-4 rounded disabled:opacity-50"
              disabled={loading}
            >
              Send
            </button>
          )}


        </form>
      </main>
    </div>
  );
}
