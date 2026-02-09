"use client";

import { useEffect, useRef, useState } from "react";
import { listConversations, getMessages, sendMessage, createConversation } from "@/lib/api";

type Conversation = { id: string; updated_at: string };
type Msg = { id: string; role: string; content: string };

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBanner, setAiBanner] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);

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

  async function startNewChat() {
    const action = async () => {
      try {
        setError(null);
        setLoading(true);

        // Create a real conversation immediately
        const res = await createConversation();
        if (!res.ok) throw new Error(res.error);

        const id = res.data.conversationId;
        setActiveId(id);
        setMessages([]);

        // Put it into the sidebar immediately
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === id);
          if (exists) return prev;
          return [{ id, updated_at: new Date().toISOString() }, ...prev];
        });

        // Focus input for instant typing
        setTimeout(() => inputRef.current?.focus(), 0);

        void refreshConversations();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create a new chat";
        setError(friendlyError(msg));
      } finally {
        setLoading(false);
      }
    };

    setLastAction(() => action);
    await action();
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

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);

    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((m) => [...m, userMsg]);
    setInput("");

    const action = async () => {
      // IMPORTANT:
      // If activeId is null, we start a new conversation by sending without an id.
      // Your API returns conversationId, so we can set it after the first request.
      const res = await sendMessage(text, activeId ?? undefined);
      if (!res.ok) throw new Error(res.error);

      const meta = res.data.meta;
      if (meta && meta.aiEnabled === false) {
        setAiBanner(
          `AI replies are disabled on the public cloud demo. Run locally to use ${meta.model || "Llama/DeepSeek"} via Ollama.`,
        );
      } else {
        setAiBanner(null);
      }


      const newConversationId: string | undefined = res.data.conversationId;

      if (!activeId && newConversationId) {
        setActiveId(newConversationId);

        // Put it in the sidebar immediately (and refresh afterward)
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === newConversationId);
          if (exists) return prev;
          return [{ id: newConversationId, updated_at: new Date().toISOString() }, ...prev];
        });

        void refreshConversations();
      }

      if (meta && meta.aiEnabled === false) {
        // Show banner only; don't add the stub reply as a chat message
        setAiBanner(
          `AI replies are disabled on the public cloud demo. Run locally to use ${meta.model || "Llama/DeepSeek"} via Ollama.`,
        );
        return;
      } else {
        setAiBanner(null);
      }

      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: res.data.reply,
        },
      ]);

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
        { id: crypto.randomUUID(), role: "assistant", content: `⚠️ ${friendlyError(msg)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">Conversations</h2>
          <button
            className="rounded border px-2 py-1 text-xs hover:bg-gray-100"
            onClick={startNewChat}
            type="button"
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
                onClick={() => void openConversation(c.id)}
                className={`cursor-pointer rounded px-2 py-1 hover:bg-gray-100 ${activeId === c.id ? "bg-gray-200" : ""
                  }`}
              >
                {c.id.slice(0, 8)}
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="flex-1 flex flex-col">
        {aiBanner && (
          <div className="border-b p-3 text-sm bg-yellow-50">
            <div className="font-medium">AI disabled on cloud demo</div>
            <div className="opacity-80">{aiBanner}</div>
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
          <button className="bg-black text-white px-4 rounded disabled:opacity-50" disabled={loading}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
