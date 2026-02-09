"use client";

import { useEffect, useRef, useState } from "react";
import { listConversations, getMessages, sendMessage } from "@/lib/api";

export default function Home() {
  const [conversations, setConversations] = useState<
    { id: string; updated_at: string }[]
  >([]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    { id: string; role: string; content: string }[]
  >([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);


  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);



  useEffect(() => {
    const load = async () => {
      try {
        const res = await listConversations();
        if (res.ok) setConversations(res.data.conversations);
        else setError(res.error);

      } catch (err) {
        console.error(err);
        // Optional: show user-facing error instead of just console
        // setError(err instanceof Error ? err.message : "Failed to load conversations");
      }
    };

    void load();
  }, []);


  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r p-4">
        <h2 className="font-bold mb-4">Conversations</h2>
        <ul className="space-y-2 text-sm">
          {conversations.map((c) => (
            <li
              key={c.id}
              onClick={() => {
                const action = async () => {
                  try {
                    setError(null);
                    setLoading(true);
                    setActiveId(c.id);
                    setMessages([]);
                    const res = await getMessages(c.id);
                    if (!res.ok) throw new Error(res.error);
                    setMessages(res.data.messages);


                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to load messages");
                  } finally {
                    setLoading(false);
                  }
                };

                setLastAction(() => action);
                void action();
              }}

              className={`cursor-pointer rounded px-2 py-1 hover:bg-gray-100 ${activeId === c.id ? "bg-gray-200" : ""
                }`}
            >
              {c.id.slice(0, 8)}
            </li>

          ))}
        </ul>
      </aside>

      <main className="flex-1 flex flex-col">
        {error && (
          <div className="border-b p-3 text-sm bg-red-50">
            <div className="font-medium">Request failed</div>
            <div className="opacity-80">{error}</div>
            {lastAction && (
              <button
                className="mt-2 rounded border px-3 py-1"
                onClick={() => void lastAction()}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {loading && (
            <div className="text-xs opacity-60">
              Thinking…
            </div>
          )}

          {!activeId && (
            <div className="text-gray-400 flex items-center justify-center h-full">
              Select a conversation
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-xl ${m.role === "user" ? "ml-auto text-right" : ""
                }`}
            >
              <div
                className={`rounded p-2 ${m.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100"
                  }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />

        </div>

        {activeId && (
          <form
            className="border-t p-4 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();

              const text = input.trim();
              if (!text || !activeId) return;

              setLoading(true);
              setError(null);


              const userMsg = {
                id: crypto.randomUUID(),
                role: "user",
                content: text,
              };

              setMessages((m) => [...m, userMsg]);
              setInput("");

              const action = async () => {
                const res = await sendMessage(text, activeId);
                if (!res.ok) throw new Error(res.error);

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
                  err instanceof Error
                    ? err.message
                    : "⚠️ Failed to get a reply. Is the API running?";
                setError(msg);
                setMessages((m) => [
                  ...m,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: `⚠️ ${msg}`,
                  },
                ]);
              } finally {
                setLoading(false);
              }

            }}

          >
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              className="bg-black text-white px-4 rounded disabled:opacity-50"
              disabled={loading}
            >
              Send
            </button>
          </form>
        )}
      </main>

    </div>
  );
}
