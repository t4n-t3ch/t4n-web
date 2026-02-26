// t4n-web/src/lib/api.ts

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };
type ApiResult<T> = ApiOk<T> | ApiErr;

export type PluginRun = {
    id: string;
    pluginName: string;
    input: unknown;
    output: unknown;
    status: "planned" | "running" | "ok" | "error";
    error?: string | null;
    createdAt: string;
    updatedAt?: string;
};

export type PluginRunsResponse = { conversationId: string; runs: PluginRun[] };

export type ExecutePluginResponse = {
    ok: boolean;
    runId: string;
    conversationId: string;
    plugin: string;
    output: unknown;
    requestId: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res: Response, text?: string, data?: unknown) {
    // Prefer Retry-After header (seconds)
    const ra = res.headers.get("retry-after");
    if (ra) {
        const seconds = Number(ra);
        if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }

    const d = asRecord(data);
    const err = d ? asRecord(d["error"]) : null;

    const hay = [
        typeof text === "string" ? text : "",
        typeof d?.["error"] === "string" ? (d["error"] as string) : "",
        typeof d?.["message"] === "string" ? (d["message"] as string) : "",
        typeof err?.["message"] === "string" ? (err["message"] as string) : "",
    ].join(" | ");

    const m = hay.match(/try again in\s+([\d.]+)\s*s/i);
    if (m?.[1]) {
        const seconds = Number(m[1]);
        if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }

    return null;
}

function isRetryableStatus(status: number) {
    return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithRetry(
    url: string,
    init: RequestInit,
    opts?: { maxRetries?: number; baseDelayMs?: number; signal?: AbortSignal }
) {
    const maxRetries = opts?.maxRetries ?? 2;      // keep low to avoid spam
    const baseDelayMs = opts?.baseDelayMs ?? 750;  // backoff base

    let attempt = 0;
    while (true) {
        const res = await fetch(url, init);

        if (!isRetryableStatus(res.status) || attempt >= maxRetries) {
            return res;
        }

        // Try to read body once to estimate retry delay (clone() keeps stream safe)
        let text: string | undefined;
        let data: unknown;
        try {
            text = await res.clone().text();
            data = text ? JSON.parse(text) : null;
        } catch {
            // ignore
        }

        const retryAfterMs = parseRetryAfterMs(res, text, data);
        const backoffMs = Math.min(
            15_000,
            retryAfterMs ?? Math.round(baseDelayMs * Math.pow(2, attempt))
        );

        // small jitter to avoid thundering herd
        const jitter = Math.floor(Math.random() * 250);

        await sleep(backoffMs + jitter);
        attempt++;
    }
}

async function apiFetch<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
    const API_BASE =
        (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
    const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";

    const timeoutMs =
        options.timeoutMs ??
        Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 90000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetchWithRetry(`${API_BASE}${path}`, {
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
            title: string | null;
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

// ✅ Rename conversation title
export function renameConversation(conversationId: string, title: string | null) {
    return apiFetch<{
        ok: boolean;
        conversationId: string;
        title: string | null;
        requestId: string;
    }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
    });
}

// ✅ Delete conversation
export function deleteConversation(conversationId: string) {
    return apiFetch<{
        ok: boolean;
        conversationId: string;
        requestId: string;
    }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
    });
}

export function sendMessage(
    message: string,
    conversationId?: string,
) {
    return apiFetch<{
        reply: string;
        conversationId: string;
        meta?: { llmMode: string; model: string; aiEnabled: boolean };
    }>("/api/chat", {
        method: "POST",
        timeoutMs: 90000,
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
    existingCode?: string
) {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001";

    const url = conversationId
        ? `${API_BASE}/api/chat/stream?conversationId=${encodeURIComponent(conversationId)}`
        : `${API_BASE}/api/chat/stream`;

    return fetchWithRetry(
        url,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "dev-key-123",
            },
            signal,
            body: JSON.stringify({
                message,
                conversationId,
                existingCode,
            }),
        },
        { maxRetries: 2, baseDelayMs: 750, signal }
    );
}

export async function executePlugin(
    conversationId: string,
    plugin: string,
    args: Record<string, unknown> = {},
) {
    return apiFetch<ExecutePluginResponse>(`/api/plugins/execute`, {
        method: "POST",
        timeoutMs: 90000,
        body: JSON.stringify({ conversationId, plugin, args }),
    });

}


export async function getPluginRuns(conversationId: string, limit: number = 25) {
    const qs = new URLSearchParams({ limit: String(limit) }).toString();
    return apiFetch<PluginRunsResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/plugins?${qs}`,
    );
}

// ============================================
// SNIPPET API FUNCTIONS
// ============================================

export type Snippet = {
    id: string;
    name: string;
    language: string;
    code: string;
    created_at: string;
    updated_at: string;
};

export type SnippetVersion = {
    id: string;
    snippet_id: string;
    code: string;
    version_number: number;
    change_summary: string | null;
    source: 'ai_generated' | 'user_edit' | 'import' | 'restore';
    created_at: string;
};

export async function getSnippets() {
    return apiFetch<{ snippets: Snippet[] }>("/api/snippets");
}

export async function getSnippet(snippetId: string) {
    return apiFetch<{ snippet: Snippet }>(`/api/snippets/${encodeURIComponent(snippetId)}`);
}

export async function createSnippet(params: {
    name: string;
    language: string;
    code: string;
    source?: 'ai_generated' | 'user_edit' | 'import';
}) {
    return apiFetch<{ id: string; name: string }>("/api/snippets", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

export async function updateSnippet(
    snippetId: string,
    params: {
        code: string;
        change_summary?: string;
        source?: 'ai_generated' | 'user_edit' | 'restore';
    }
) {
    return apiFetch<{ version: number }>(`/api/snippets/${encodeURIComponent(snippetId)}`, {
        method: "PUT",
        body: JSON.stringify(params),
    });
}

export async function deleteSnippet(snippetId: string) {
    return apiFetch<{ snippetId: string }>(`/api/snippets/${encodeURIComponent(snippetId)}`, {
        method: "DELETE",
    });
}

export async function getSnippetVersions(snippetId: string, limit: number = 20) {
    return apiFetch<{ versions: SnippetVersion[] }>(
        `/api/snippets/${encodeURIComponent(snippetId)}/versions?limit=${limit}`
    );
}

export async function restoreSnippetVersion(snippetId: string, versionNumber: number) {
    return apiFetch<{ version: number }>(
        `/api/snippets/${encodeURIComponent(snippetId)}/restore/${versionNumber}`,
        { method: "POST" }
    );
}

export async function updateSnippetVersion(
    snippetId: string,
    versionNumber: number,
    params: {
        change_summary?: string;
    }
) {
    return apiFetch<{ version: number }>(
        `/api/snippets/${encodeURIComponent(snippetId)}/versions/${versionNumber}`,
        {
            method: "PATCH",
            body: JSON.stringify(params),
        }
    );
}

export async function deleteSnippetVersion(
    snippetId: string,
    versionNumber: number
) {
    return apiFetch<{ version: number }>(
        `/api/snippets/${encodeURIComponent(snippetId)}/versions/${versionNumber}`,
        {
            method: "DELETE",
        }
    );
}

