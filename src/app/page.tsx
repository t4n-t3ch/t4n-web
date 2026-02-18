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
  type PluginRun,
} from "@/lib/api";




type Conversation = { id: string; updated_at: string };
type Msg = { id: string; role: string; content: string };


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
  const [pluginName, setPluginName] = useState<
    "healthcheck" | "summariseConversation" | "exportConversation"
  >("summariseConversation");

  const [pluginBusy, setPluginBusy] = useState(false);

  const [pluginResult, setPluginResult] = useState<unknown>(null);
  const [pluginRuns, setPluginRuns] = useState<PluginRun[]>([]);

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
      // If a stream is in progress, cancel it before switching chats
      if (streaming) cancelStreamSilently();

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

  async function summariseToChat() {
    try {
      setError(null);
      setPluginBusy(true);
      setToolBanner(null);

      let cid = activeId;

      // If no conversation yet, create one automatically
      if (!cid) {
        const newId = await startNewChat();
        if (!newId) throw new Error("Failed to create conversation");
        cid = newId;
      }

      // IMPORTANT: do NOT save as message in DB here — we append in UI
      const args = { conversationId: cid, limit: 50, saveAsMessage: false };

      const res = await executePlugin(cid, "summariseConversation", args);
      if (!res.ok) throw new Error(res.error);

      // Extract a readable summary string (no any)
      const output: unknown = res.data.output;

      const summary = (() => {
        if (typeof output === "string") return output;

        if (output && typeof output === "object" && !Array.isArray(output)) {
          const maybe = output as Record<string, unknown>;
          if (typeof maybe.summary === "string") return maybe.summary;
        }

        return JSON.stringify(output, null, 2);
      })();

      setMessages((m) => [
        ...m,
        {
          id: globalThis.crypto.randomUUID(),
          role: "assistant",
          content: `🧾 Conversation summary\n\n${summary}`,
        },
      ]);

      await refreshPluginRuns(cid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Summary failed";
      setError(friendlyError(msg));
    } finally {
      setPluginBusy(false);
    }
  }

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

  async function retryLastSend() {
    const payload = lastSendRef.current;
    if (!payload || !payload.text) return;

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
      lastAssistantIdRef.current = assistantId;


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

      const res = await streamMessage(payload.text, cid, controller.signal);


      let streamed = "";
      let sawDone = false;

      await readSseStream(
        res,
        (delta) => {
          streamed += delta;
          setMessages((m) =>
            m.map((msg) => (msg.id === assistantId ? { ...msg, content: streamed } : msg)),
          );
        },
        () => { sawDone = true; },
        undefined,
        undefined,
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
    if (!text || loading) return;

    lastSendRef.current = { text, conversationId: activeId ?? undefined };
    setCanRetry(true);

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
      const assistantId = activeAssistantIdRef.current ?? globalThis.crypto.randomUUID();
      activeAssistantIdRef.current = assistantId;

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

      const payload = lastSendRef.current ?? { text, conversationId: activeId ?? undefined };
      const res = await streamMessage(payload.text, payload.conversationId, controller.signal);

      let streamed = "";
      let sawDone = false;


      await readSseStream(
        res,
        (delta) => {
          streamed += delta;
          setMessages((m) =>
            m.map((msg) => (msg.id === assistantId ? { ...msg, content: streamed } : msg)),
          );
        },
        (doneData) => {
          sawDone = true;
          const newConversationId = doneData?.conversationId;

          // Existing convo: refresh runs at end of stream too
          if (activeId) void refreshPluginRuns(activeId);

          // If this was the first message of a brand new chat, adopt the server-provided conversationId
          if (!activeId && newConversationId) {
            // Make sure Retry uses the server-issued conversationId for the very first message
            if (lastSendRef.current) {
              lastSendRef.current = { text: lastSendRef.current.text, conversationId: newConversationId };
            }
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
              setPluginName(
                e.target.value as "healthcheck" | "summariseConversation" | "exportConversation",
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

          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-50"
            onClick={() => void summariseToChat()}
            disabled={pluginBusy}
            title={!activeId ? "No conversation selected — will create one automatically" : ""}
          >
            Summarise → Chat
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


        <div className="flex-1 p-4 overflow-y-auto space-y-3">
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
                  {isActiveStreaming ? " ▍" : ""}
                </div>
              </div>
            );
          })}


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
            <>
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
