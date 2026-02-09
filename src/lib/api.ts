// t4n-web/src/lib/api.ts

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };
type ApiResult<T> = ApiOk<T> | ApiErr;

async function apiFetch<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
    const API_BASE =
        (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
    const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";

    const timeoutMs =
        options.timeoutMs ??
        Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 25000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": API_KEY,
                ...(options.headers || {}),
            },
        });

        const text = await res.text();
        const data = text
            ? (() => {
                try {
                    return JSON.parse(text);
                } catch {
                    return null;
                }
            })()
            : null;

        if (!res.ok) {
            return {
                ok: false,
                error:
                    (data && (data.error || data.message)) ||
                    text ||
                    res.statusText ||
                    `Request failed (${res.status})`,
            };
        }

        return { ok: true, data: data as T };
    } catch (err: unknown) {
        const msg =
            err instanceof DOMException && err.name === "AbortError"
                ? `Request timed out after ${timeoutMs}ms`
                : err instanceof Error
                    ? err.message
                    : "Network error";

        return { ok: false, error: msg };
    } finally {
        clearTimeout(timeoutId);
    }
}

/* ============================
   API FUNCTIONS
   ============================ */

export function createConversation() {
    return apiFetch<{
        conversationId: string;
    }>("/api/conversations", {
        method: "POST",
    });
}

export function listConversations() {
    return apiFetch<{
        conversations: {
            id: string;
            created_at: string;
            updated_at: string;
        }[];
    }>("/api/conversations");
}

export function getMessages(conversationId: string) {
    return apiFetch<{
        conversationId: string;
        messages: {
            id: string;
            role: "system" | "user" | "assistant";
            content: string;
            created_at: string;
        }[];
    }>(`/api/conversations/${conversationId}/messages`);
}

export function sendMessage(
    message: string,
    conversationId?: string,
) {
    return apiFetch<{
        reply: string;
        conversationId: string;
        meta?: {
            llmMode: string;
            model: string;
            aiEnabled: boolean;
        };
    }>("/api/chat", {

        method: "POST",
        body: JSON.stringify({ message, conversationId }),
    });
}

/**
 * SSE streaming chat
 * Returns the raw Response so the caller can read the stream
 */
/**
 * SSE streaming chat
 * Returns the raw Response so the caller can read the stream
 */
export async function streamMessage(
    message: string,
    conversationId?: string,
    signal?: AbortSignal,
) {
    const API_BASE =
        (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
    const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";

    return fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        body: JSON.stringify({ message, conversationId }),
        signal,
    });
}

