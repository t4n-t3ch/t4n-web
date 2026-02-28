"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { Session } from "@supabase/supabase-js";
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
    getSnippets,
    getSnippet,           // Add this if missing
    createSnippet,
    updateSnippet,
    deleteSnippet as apiDeleteSnippet,
    getSnippetVersions,
    restoreSnippetVersion,
    type Snippet,
    type PluginRun,
    getProjects as apiGetProjects,
    createProject as apiCreateProject,
    updateProject as apiUpdateProject,
    deleteProject as apiDeleteProject,
    addProjectFile as apiAddProjectFile,
    deleteProjectFile as apiDeleteProjectFile,
    getProjectDetail,
    type Project as ApiProject,
    type ProjectFile as ApiProjectFile,
} from "@/lib/api";



// Import SnippetVersion type separately since it's not exported yet
type SnippetVersion = {
    id: string;
    snippet_id: string;
    code: string;
    version_number: number;
    change_summary: string | null;
    source: 'ai_generated' | 'user_edit' | 'import' | 'restore';
    created_at: string;
};

/* eslint-disable react/no-unescaped-entities */

type Project = {
    id: string;
    name: string;
    description: string | null;
    ai_instructions: string | null;
    emoji: string | null;
    color: string;
    created_at: string;
    updated_at: string;
};

type ProjectFile = {
    id: string;
    project_id: string;
    name: string;
    content: string;
    file_type: string;
    size_bytes: number;
    created_at: string;
};

type Conversation = {
    id: string;
    title?: string | null;
    created_at?: string;
    updated_at: string;
    project_id?: string | null;
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

export default function HomeClient() {
    const [session, setSession] = useState<Session | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authEmail, setAuthEmail] = useState("");
    const [authPassword, setAuthPassword] = useState("");
    const [authError, setAuthError] = useState<string | null>(null);
    const [authMode, setAuthMode] = useState<"login" | "signup">("login");

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setAuthLoading(false);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });
        return () => subscription.unsubscribe();
    }, []);

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [lastEventType, setLastEventType] = useState<'generated' | 'updated' | 'streaming' | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [promptDisplayMode, setPromptDisplayMode] = useState<'description' | 'minimal'>('description');
    const [pluginName, setPluginName] = useState<
        "healthcheck" | "summariseConversation" | "exportConversation"
    >("summariseConversation");

    const [pluginBusy, setPluginBusy] = useState(false);

    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    useEffect(() => {
        try {
            const saved = localStorage.getItem('t4n_theme') as 'dark' | 'light' | null;
            if (saved) setTheme(saved);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('t4n_theme', theme);
        } catch { /* ignore */ }
        if (theme === 'light') {
            document.documentElement.classList.add('light');
        } else {
            document.documentElement.classList.remove('light');
        }
    }, [theme]);

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeSettingsTab, setActiveSettingsTab] = useState<'prompts' | 'plugins' | 'appearance'>('prompts');

    const [pluginResult, setPluginResult] = useState<unknown>(null);
    const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);
    const codeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [pluginRuns, setPluginRuns] = useState<PluginRun[]>([]);
    // last tool event emitted from /api/chat/stream (server sends `event: tool`)

    const [titles, setTitles] = useState<Record<string, string>>({});
    const [convSearch, setConvSearch] = useState("");
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectFilter, setActiveProjectFilter] = useState<string | null>(null);
    const [showProjectsPage, setShowProjectsPage] = useState(false);
    const [convProjects, setConvProjects] = useState<Record<string, string>>({}); // convId -> projectId
    const [activeProjectDetail, setActiveProjectDetail] = useState<string | null>(null); // project id being viewed
    const [projectFiles, setProjectFiles] = useState<Record<string, ProjectFile[]>>({}); // projectId -> files
    const [projectDetailTab, setProjectDetailTab] = useState<'overview' | 'files' | 'instructions'>('overview');
    const [editingProject, setEditingProject] = useState<Partial<Project> & { id: string } | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectsSynced, setProjectsSynced] = useState(false); // have we loaded from API yet?

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

    // Undo/Redo for code canvas
    const [codeHistory, setCodeHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const MAX_HISTORY = 50;

    // Using imported Snippet type

    const [savedCodes, setSavedCodes] = useState<Snippet[]>([]);
    const [activeCodeId, setActiveCodeId] = useState<string | null>(null);
    const [giveAiAccessToCode, setGiveAiAccessToCode] = useState(false);
    const [accessLockedSnippetId, setAccessLockedSnippetId] = useState<string | null>(null);
    const [accessLockedCode, setAccessLockedCode] = useState<string>("");
    const [loadingSnippets, setLoadingSnippets] = useState(false);
    const [snippetVersions, setSnippetVersions] = useState<SnippetVersion[]>([]);
    const [showVersions, setShowVersions] = useState(false);

    // Unsaved snippet handling
    const UNSAVED_ID = 'unsaved';
    const [unsavedCode, setUnsavedCode] = useState<string>("");
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Load snippets from API
    useEffect(() => {
        if (!session) return;
        async function loadSnippets() {
            setLoadingSnippets(true);
            try {
                const res = await getSnippets();
                if (res.ok) {
                    setSavedCodes(res.data.snippets);
                }
            } catch (error) {
                console.error("Failed to load snippets:", error);
            } finally {
                setLoadingSnippets(false);
            }
        }
        loadSnippets();
    }, [session]);

    useEffect(() => {
        try {
            localStorage.setItem("t4n_saved_codes", JSON.stringify(savedCodes));
        } catch {
            // ignore
        }
    }, [savedCodes]);

    async function loadVersions(snippetId: string) {
        try {
            setLoadingSnippets(true);
            const res = await getSnippetVersions(snippetId);
            if (res.ok) {
                setSnippetVersions(res.data.versions);
            } else {
                console.error("Failed to load versions:", res.error);
            }
        } catch (error) {
            console.error("Failed to load versions:", error);
        } finally {
            setLoadingSnippets(false);
        }
    }

    async function saveCurrentCode() {
        if (!codeText.trim()) return;

        try {
            const res = await createSnippet({
                name: `Snippet ${savedCodes.length + 1}`,
                language: "pinescript", // You might want to detect this
                code: codeText,
                source: 'user_edit'
            });

            if (res.ok) {
                // Refresh the list
                const snippetsRes = await getSnippets();
                if (snippetsRes.ok) {
                    setSavedCodes(snippetsRes.data.snippets);
                    setActiveCodeId(res.data.id);
                }
            }
        } catch (error) {
            console.error("Failed to save snippet:", error);
        }
    }

    async function updateActiveSnippet() {
        if (!activeCodeId) return;
        if (!codeText.trim()) return;

        try {
            const res = await updateSnippet(activeCodeId!, {
                code: codeText,
                source: 'user_edit',
                change_summary: 'Manual edit'
            });

            if (res.ok) {
                // Refresh the snippets list
                const snippetsRes = await getSnippets();
                if (snippetsRes.ok) {
                    setSavedCodes(snippetsRes.data.snippets);
                }
            }
        } catch (error) {
            console.error("Failed to update snippet:", error);
        }
    }

    async function renameSnippet(id: string) {
        const current = savedCodes.find((s) => s.id === id)?.name ?? "";
        const next = prompt("Rename snippet:", current);
        if (!next || !next.trim()) return;

        // Update local state immediately
        setSavedCodes((p) => p.map((x) => (x.id === id ? { ...x, name: next.trim() } : x)));

        // Call dedicated rename endpoint
        try {
            const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
            const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";

            const res = await fetch(`${API_BASE}/api/snippets/${encodeURIComponent(id)}/rename`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
                body: JSON.stringify({ name: next.trim() }),
            });

            if (!res.ok) {
                console.error("Failed to persist rename:", await res.text());
            }
        } catch (err) {
            console.error("Rename API call failed:", err);
        }
    }

    async function deleteSnippet(id: string) {
        if (!confirm("Delete this snippet?")) return;

        try {
            const res = await apiDeleteSnippet(id);
            if (res.ok) {
                setSavedCodes((p) => p.filter((x) => x.id !== id));
                setActiveCodeId((cur) => (cur === id ? null : cur));
                setGiveAiAccessToCode(false);
            }
        } catch (error) {
            console.error("Failed to delete snippet:", error);
        }
    }


    const wantsCodeRef = useRef(false);
    const descriptionRef = useRef<string>("");

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

    function applyPartialCodePatch(existingCode: string, newCode: string): string {
        // Detect if AI returned a partial patch (truncated with comment)
        const truncationMarkers = [
            /\/\/\s*\.\.\.\s*\(rest of the code.*?\)/i,
            /\/\/\s*\.\.\.\s*rest remains/i,
            /\/\/\s*\.\.\.\s*\(remaining code/i,
            /\/\/\s*rest of the (code|script|file) (remains|stays|unchanged)/i,
            /\/\/\s*\.\.\.\s*unchanged/i,
            /\/\/\s*\.\.\.\s*same as before/i,
        ];

        const markerMatch = truncationMarkers.reduce<RegExpExecArray | null>((found, re) => {
            if (found) return found;
            return re.exec(newCode) ?? null;
        }, null);

        if (!markerMatch || !existingCode.trim()) return newCode;

        // Get the code before the truncation marker
        const patchPart = newCode.slice(0, markerMatch.index).trimEnd();
        if (!patchPart) return newCode;

        // Find where in the existing code the patch ends
        // Strategy: take last non-empty line of patch and find it in existing code
        const patchLines = patchPart.split('\n').filter(l => l.trim());
        const lastPatchLine = patchLines[patchLines.length - 1]?.trim();

        if (!lastPatchLine) return newCode;

        const existingLines = existingCode.split('\n');
        let mergePoint = -1;

        // Find the last occurrence of the last patch line in existing code
        for (let i = existingLines.length - 1; i >= 0; i--) {
            if (existingLines[i].trim() === lastPatchLine) {
                mergePoint = i;
                break;
            }
        }

        if (mergePoint === -1) {
            // Fallback: count patch lines and splice from that point in existing
            const patchLineCount = patchPart.split('\n').length;
            // Add a small overlap buffer — go back 3 lines in case of off-by-one
            const spliceFrom = Math.max(0, patchLineCount - 3);
            const rest = existingLines.slice(spliceFrom).join('\n');
            // Only append if rest isn't already in patch
            if (patchPart.includes(existingLines[spliceFrom]?.trim() ?? "NOMATCH")) {
                return patchPart + '\n' + existingLines.slice(patchLineCount).join('\n');
            }
            return patchPart + '\n' + rest;
        }

        // Merge: patch + rest of existing from merge point + 1
        const restOfExisting = existingLines.slice(mergePoint + 1).join('\n');
        return patchPart + '\n' + restOfExisting;
    }

    function mergePatchWithExisting(existingCode: string, patchCode: string): string {
        // Check if the patch uses the new marker format
        const startMarker = "// --- REPLACE SECTION STARTING HERE ---";
        const endMarker = "// --- REST OF CODE REMAINS UNCHANGED ---";

        const hasStartMarker = patchCode.includes(startMarker);
        const hasEndMarker = patchCode.includes(endMarker);

        // If it's using the new marker format
        if (hasStartMarker && hasEndMarker) {
            const startIdx = patchCode.indexOf(startMarker) + startMarker.length;
            const endIdx = patchCode.indexOf(endMarker);

            // Extract just the changed section
            const changedSection = patchCode.substring(startIdx, endIdx).trim();

            if (!changedSection) return existingCode;

            // Split into lines
            const changedLines = changedSection.split('\n');
            const existingLines = existingCode.split('\n');

            // Try to find where to insert - look for a unique line from the changed section
            if (changedLines.length > 0) {
                // Get the first non-empty line of the changed section
                const firstChangedLine = changedLines.find(line => line.trim().length > 0);

                if (firstChangedLine) {
                    const trimmedFirstLine = firstChangedLine.trim();

                    // Find this line in the existing code
                    for (let i = 0; i < existingLines.length; i++) {
                        if (existingLines[i].trim().includes(trimmedFirstLine)) {
                            // Found the insertion point
                            const linesBefore = existingLines.slice(0, i);
                            const linesAfter = existingLines.slice(i + changedLines.length);

                            return [...linesBefore, ...changedLines, ...linesAfter].join('\n');
                        }
                    }
                }
            }

            // Fallback: append the changed section with a warning
            return existingCode + '\n\n// PATCH ADDED:\n' + changedSection;
        }

        // If no markers, fall back to the existing truncation marker logic
        return applyPartialCodePatch(existingCode, patchCode);
    }

    function addToHistory(newCode: string, opts?: { allowEmpty?: boolean }) {
        const allowEmpty = opts?.allowEmpty ?? false;
        if (!allowEmpty && !newCode.trim()) return;

        // Don't add duplicate consecutive entries
        if (codeHistory[historyIndex] === newCode) return;

        // Remove any future history if we're not at the end
        const newHistory = codeHistory.slice(0, historyIndex + 1);

        // Add new code
        newHistory.push(newCode);

        // Keep only last MAX_HISTORY items
        if (newHistory.length > MAX_HISTORY) {
            newHistory.shift();
        }

        setCodeHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }

    function handleUndo() {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setCodeText(codeHistory[newIndex]);
            setHasUnsavedChanges(true);
        }
    }

    function handleRedo() {
        if (historyIndex < codeHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setCodeText(codeHistory[newIndex]);
            setHasUnsavedChanges(true);
        }
    }

    function handleNewCode() {
        if (codeText.trim() && !confirm("Create new code? Unsaved changes will be lost.")) {
            return;
        }

        // Clear current code
        setCodeText("");
        setUnsavedCode("");
        setHasUnsavedChanges(false);
        setActiveCodeId(null);
        setGiveAiAccessToCode(false);

        // Add empty state to history
        addToHistory("", { allowEmpty: true });
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

        // Don't apply Pine heuristics if this looks like Ctrl+F instructions
        if (/ctrl\+f:/i.test(text)) return "";

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

    function highlightInCanvas(searchText: string) {
        const ta = codeTextareaRef.current;
        if (!ta || !searchText) return;
        const idx = ta.value.indexOf(searchText);
        if (idx === -1) return;
        setCodeOpen(true);
        requestAnimationFrame(() => {
            const el = codeTextareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(idx, idx + searchText.length);
            const linesBefore = el.value.slice(0, idx).split('\n').length;
            const lineHeight = 20;
            el.scrollTop = Math.max(0, (linesBefore - 3) * lineHeight);
        });
    }

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
        if (!session) return;
        void refreshConversations();
        void syncProjectsFromApi();
    }, [session]);

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
            descriptionRef.current = ""; // Add this line
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
            wantsCodeRef.current = promptLooksLikeCodeRequest(payload.text) || (hasExistingCode && wantsEdit) || (giveAiAccessToCode && !!codeText.trim());

            // Use the locked snapshot when access was granted — not live codeText
            // This prevents browsing other snippets from changing what gets sent
            const codeForContext = (giveAiAccessToCode && accessLockedCode)
                ? accessLockedCode
                : codeText;
            const trimmedForPrompt = codeForContext.slice(0, 120000);
            const codeContext =
                giveAiAccessToCode && codeForContext.trim()
                    ? `\n\nEXISTING CODE (you MUST either give Ctrl+F find-and-replace instructions OR output the FULL corrected file — NEVER output a partial truncated file):\n\`\`\`pinescript\n${trimmedForPrompt}\n\`\`\`\n`
                    : "";

            const finalText = (wantsCodeRef.current || (giveAiAccessToCode && codeForContext.trim()))
                ? `USER REQUEST:
${payload.text}${codeContext ? `

${codeContext}` : ""}`
                : payload.text;


            // Send first 800 chars (structure/header) + last 400 chars (tail) 
            // so AI knows the shape without seeing the full file
            const codeToSend = undefined; // Code already sent inside finalText via codeContext
            const res = await streamMessage(finalText, cid, controller.signal, codeToSend);


            let streamed = "";
            let sawDone = false;

            await readSseStream(
                res,
                (delta) => {
                    streamed += delta;

                    const extracted = extractCodeBlocks(streamed);

                    // If we detect code, push it to the code canvas and OPEN the code panel.
                    if (extracted && !/ctrl\+f:/i.test(streamed)) {
                        const merged = (giveAiAccessToCode && accessLockedCode.trim())
                            ? mergePatchWithExisting(accessLockedCode, extracted)
                            : extracted;

                        setCodeText(merged);
                        addToHistory(merged);

                        if (!activeCodeId) {
                            setUnsavedCode(merged);
                            setHasUnsavedChanges(true);
                        }

                        if (giveAiAccessToCode) {
                            setAccessLockedCode(merged);
                        }

                        setCodeOpen((v) => (v ? v : true));
                    }

                    // HARD RULE: if ANY code detected, chat shows ONLY the hint (no code, no mixed text)
                    // Set a simple neutral description when code is first detected
                    if (extracted && wantsCodeRef.current && !descriptionGenerated && promptDisplayMode === 'description') {
                        const newDescription = "\n\n**Code updated** — open the Code panel to review changes.";
                        descriptionRef.current = newDescription;
                        setCodeDescription(newDescription);
                        setDescriptionGenerated(true);
                    }

                    // Determine what message to show based on display mode and event type
                    let messageToShow = "";

                    // During streaming, use the ref value if available, otherwise use state
                    const currentDescription = descriptionRef.current || codeDescription;

                    const isCtrlFResponse = /ctrl\+f:/i.test(streamed);

                    if (isCtrlFResponse) {
                        // Always show Ctrl+F instructions as-is in chat, never touch them
                        messageToShow = streamed;
                    } else if (promptDisplayMode === 'description' && currentDescription && extracted) {
                        messageToShow = `[Code generated → open the Code panel]${currentDescription}`;
                    } else if (extracted) {
                        messageToShow = "[Code generated → open the Code panel]";
                    } else {
                        messageToShow = stripCodeBlocks(streamed);
                    }

                    setMessages((m) =>
                        m.map((msg) =>
                            msg.id === assistantId ? { ...msg, content: messageToShow } : msg,
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
                ? `\n\n[PINE SCRIPT COMPILER ERROR - exact text from screenshot]\n${ocrParts.trim()}\n[END ERROR]\nFix ONLY the error shown above. Do not change anything else.`
                : attachments.length > 0
                    ? `\n\n[SCREENSHOT ATTACHED - user is showing a compiler error]\n`
                    : "";

        // What the user sees vs what the API receives
        const uiText = text;
        const apiText = `${text}${screenshotContext}`.trim();

        // Determine if user intent requires code-mode (edit existing code OR request code)
        const hasExistingCode = giveAiAccessToCode && !!codeText.trim(); // This is correct - requires access
        const wantsEdit = looksLikeEditRequest(apiText);

        // Enable code mode if:
        // 1. User explicitly asked for code, OR
        // 2. User has given access AND wants to edit, OR
        // 3. Access is ON and message contains error/fix keywords (screenshot error flow)
        const looksLikeErrorFix = /\b(error|fix|wrong|broken|not working|compile|failed|issue|problem|incorrect|crash)\b/i.test(apiText);
        wantsCodeRef.current = promptLooksLikeCodeRequest(apiText)
            || (hasExistingCode && wantsEdit)
            || (giveAiAccessToCode && !!codeText.trim())
            || (giveAiAccessToCode && looksLikeErrorFix);

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
            descriptionRef.current = ""; // Add this line
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

            // Use locked snapshot if available, otherwise fall back to live codeText
            const codeForContext = (giveAiAccessToCode && accessLockedCode)
                ? accessLockedCode
                : codeText;
            const trimmedForPrompt = codeForContext.slice(0, 120000);
            const codeContext =
                giveAiAccessToCode && codeForContext.trim()
                    ? `\n\nEXISTING CODE (you MUST either output the FULL corrected file OR give Ctrl+F find-and-replace instructions — NEVER output a partial truncated file):\n\`\`\`pinescript\n${trimmedForPrompt}\n\`\`\`\n`
                    : "";

            const finalText = (wantsCodeRef.current || (giveAiAccessToCode && codeForContext.trim()))
                ? `USER REQUEST:
${payload.text}${codeContext ? `

${codeContext}` : ""}`
                : payload.text;

            // Hard cap code at 2000 chars client-side — server will trim further
            // For large scripts, the AI only needs the relevant section anyway
            // Send first 800 chars (structure/header) + last 400 chars (tail) 
            // so AI knows the shape without seeing the full file
            const res = await streamMessage(finalText, payload.conversationId, controller.signal);
            let streamed = "";
            let sawDone = false;


            await readSseStream(
                res,
                (delta) => {
                    streamed += delta;

                    const extracted = extractCodeBlocks(streamed);

                    if (extracted && !/ctrl\+f:/i.test(streamed)) {
                        const merged = (giveAiAccessToCode && accessLockedCode.trim())
                            ? mergePatchWithExisting(accessLockedCode, extracted)
                            : extracted;

                        setCodeText(merged);
                        addToHistory(merged);

                        if (!activeCodeId) {
                            setUnsavedCode(merged);
                            setHasUnsavedChanges(true);
                        }

                        if (giveAiAccessToCode) {
                            setAccessLockedCode(merged);
                        }

                        if (wantsCodeRef.current) {
                            setCodeOpen(true);
                        }
                    }

                    // Set event type based on what's happening
                    if (extracted) {
                        setLastEventType('generated');
                    } else if (streaming) {
                        setLastEventType('streaming');
                    }

                    // Generate description only once when code is first detected (only if description mode is enabled)
                    if (extracted && wantsCodeRef.current && !descriptionGenerated && promptDisplayMode === 'description') {
                        const newDescription = "\n\n**Code updated** — open the Code panel to review changes.";
                        descriptionRef.current = newDescription;
                        setCodeDescription(newDescription);
                        setDescriptionGenerated(true);
                    }

                    // Determine what message to show based on display mode and event type
                    let messageToShow = "";

                    // During streaming, use the ref value if available, otherwise use state
                    const currentDescription = descriptionRef.current || codeDescription;

                    const isCtrlFResponse = /ctrl\+f:/i.test(streamed);

                    if (isCtrlFResponse) {
                        // Always show Ctrl+F instructions as-is in chat, never touch them
                        messageToShow = streamed;
                    } else if (promptDisplayMode === 'description' && currentDescription && extracted) {
                        messageToShow = `[Code generated → open the Code panel]${currentDescription}`;
                    } else if (extracted) {
                        messageToShow = "[Code generated → open the Code panel]";
                    } else {
                        messageToShow = stripCodeBlocks(streamed);
                    }

                    setMessages((m) =>
                        m.map((msg) =>
                            msg.id === assistantId ? { ...msg, content: messageToShow } : msg,
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

    if (authLoading) return (
        <div className="flex h-screen items-center justify-center" style={{ background: '#0f0f11', color: '#9ca3af' }}>
            Loading…
        </div>
    );

    if (!session) return (
        <div className="flex h-screen items-center justify-center" style={{ background: '#0f0f11' }}>
            <div style={{ width: 360, background: '#1e1e24', border: '1px solid #2a2a35', borderRadius: 12, padding: 32 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f97316', marginBottom: 8 }}>T4N</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 24 }}>
                    {authMode === "login" ? "Sign in to continue" : "Create your account"}
                </div>
                {authError && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#f87171', marginBottom: 16 }}>
                        {authError}
                    </div>
                )}
                <input 
                    type="email" 
                    placeholder="Email" 
                    value={authEmail} 
                    onChange={e => setAuthEmail(e.target.value)}
                    style={{ width: '100%', background: '#0f0f11', border: '1px solid #2a2a35', borderRadius: 6, padding: '10px 12px', color: '#e2e2e8', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} 
                />
                <input 
                    type="password" 
                    placeholder="Password" 
                    value={authPassword} 
                    onChange={e => setAuthPassword(e.target.value)}
                    style={{ width: '100%', background: '#0f0f11', border: '1px solid #2a2a35', borderRadius: 6, padding: '10px 12px', color: '#e2e2e8', fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }} 
                />
                <button 
                    style={{ width: '100%', background: '#f97316', border: 'none', borderRadius: 6, padding: '10px 0', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}
                    onClick={async () => {
                        setAuthError(null);
                        if (authMode === "login") {
                            const { error } = await supabase.auth.signInWithPassword({ 
                                email: authEmail, 
                                password: authPassword 
                            });
                            if (error) setAuthError(error.message);
                        } else {
                            const { error } = await supabase.auth.signUp({ 
                                email: authEmail, 
                                password: authPassword 
                            });
                            if (error) setAuthError(error.message);
                        }
                    }}>
                    {authMode === "login" ? "Sign In" : "Sign Up"}
                </button>
                <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
                    {authMode === "login" ? (
                        <>No account? <button onClick={() => { setAuthMode("signup"); setAuthError(null); }} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Sign up</button></>
                    ) : (
                        <>Have an account? <button onClick={() => { setAuthMode("login"); setAuthError(null); }} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Sign in</button></>
                    )}
                </div>
            </div>
        </div>
    );

    const PROJECT_COLORS = ['#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899','#f59e0b','#06b6d4','#ef4444'];

    async function createProject() {
        const name = prompt("Project name:");
        if (!name?.trim()) return;
        const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
        const emoji = '📁';

        // Optimistic local add
        const tempId = globalThis.crypto.randomUUID();
        const project: Project = {
            id: tempId,
            name: name.trim(),
            description: null,
            ai_instructions: null,
            emoji,
            color,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        setProjects(p => [...p, project]);

        try {
            const res = await apiCreateProject({ name: name.trim(), emoji, color });
            if (res.ok) {
                // Replace temp id with real id
                setProjects(p => p.map(x => x.id === tempId ? { ...x, id: res.data.id } : x));
            }
        } catch (e) {
            console.error("Failed to create project:", e);
        }
    }

    async function deleteProject(id: string) {
        if (!confirm("Delete project? Conversations will be unassigned.")) return;
        setProjects(p => p.filter(x => x.id !== id));
        setConvProjects(prev => {
            const next = { ...prev };
            for (const k of Object.keys(next)) { if (next[k] === id) delete next[k]; }
            return next;
        });
        if (activeProjectFilter === id) setActiveProjectFilter(null);
        if (activeProjectDetail === id) setActiveProjectDetail(null);

        try {
            await apiDeleteProject(id);
        } catch (e) {
            console.error("Failed to delete project:", e);
        }
    }

    async function saveProjectEdits() {
        if (!editingProject) return;
        const { id, ...fields } = editingProject;

        // Optimistic update
        setProjects(p => p.map(x => x.id === id ? { ...x, ...fields } : x));
        setEditingProject(null);

        try {
            await apiUpdateProject(id, fields);
        } catch (e) {
            console.error("Failed to update project:", e);
        }
    }

    async function uploadProjectFile(projectId: string, file: File) {
        const text = await file.text();
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'txt';
        const fileType = ['ts','tsx','js','jsx','py','sql','md','txt','json','yaml','yml','sh'].includes(ext) ? ext : 'text';

        // Optimistic local add
        const tempFile: ProjectFile = {
            id: `temp-${globalThis.crypto.randomUUID()}`,
            project_id: projectId,
            name: file.name,
            content: text,
            file_type: fileType,
            size_bytes: text.length,
            created_at: new Date().toISOString(),
        };
        setProjectFiles(prev => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), tempFile] }));

        try {
            const res = await apiAddProjectFile(projectId, { name: file.name, content: text, file_type: fileType });
            if (res.ok) {
                setProjectFiles(prev => ({
                    ...prev,
                    [projectId]: (prev[projectId] ?? []).map(f => f.id === tempFile.id ? { ...f, id: res.data.id } : f),
                }));
            }
        } catch (e) {
            console.error("Failed to upload file:", e);
        }
    }

    async function removeProjectFile(projectId: string, fileId: string) {
        setProjectFiles(prev => ({ ...prev, [projectId]: (prev[projectId] ?? []).filter(f => f.id !== fileId) }));
        try {
            await apiDeleteProjectFile(projectId, fileId);
        } catch (e) {
            console.error("Failed to delete file:", e);
        }
    }

    function assignToProject(convId: string, projectId: string | null) {
        setConvProjects(prev => {
            const next = { ...prev };
            if (projectId === null) { delete next[convId]; } else { next[convId] = projectId; }
            return next;
        });
    }

    async function syncProjectsFromApi() {
        if (projectsSynced) return;
        try {
            setProjectsLoading(true);
            const res = await apiGetProjects();
            if (res.ok) {
                setProjects(res.data.projects.map((p: ApiProject) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    ai_instructions: p.ai_instructions,
                    emoji: p.emoji,
                    color: p.color,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                })));
                setProjectsSynced(true);
            }
        } catch (e) {
            console.error("Failed to sync projects:", e);
        } finally {
            setProjectsLoading(false);
        }
    }

    async function loadProjectDetail(projectId: string) {
        try {
            const res = await getProjectDetail(projectId);
            if (res.ok) {
                setProjectFiles(prev => ({ ...prev, [projectId]: res.data.files }));
                // Sync any conversation-project assignments
                for (const c of res.data.conversations) {
                    setConvProjects(prev => ({ ...prev, [c.id]: projectId }));
                }
            }
        } catch (e) {
            console.error("Failed to load project detail:", e);
        }
    }

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Projects Page Overlay */}
            {showProjectsPage && (
                <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg-primary)' }}>
                    {/* Header */}
                    <div className="flex items-center gap-3 p-4" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                        <Image src="/t4n-logo.png" alt="T4N" width={22} height={22} className="h-5 w-5 object-contain opacity-90" />
                        <span style={{ fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)' }}>
                            {activeProjectDetail ? (projects.find(p => p.id === activeProjectDetail)?.name ?? 'Project') : 'Projects'}
                        </span>
                        {activeProjectDetail && (
                            <button type="button" onClick={() => { setActiveProjectDetail(null); setShowEmojiPicker(false); }}
                                style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                ← All projects
                            </button>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {!activeProjectDetail && (
                                <button type="button" className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }} onClick={createProject}>
                                    + New project
                                </button>
                            )}
                            <button type="button" className="btn-secondary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={() => { setShowProjectsPage(false); setActiveProjectDetail(null); setShowEmojiPicker(false); }}>
                                ✕ Close
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    {!activeProjectDetail ? (
                        // ── Projects grid ────────────────────────────────────
                        <div className="flex-1 overflow-y-auto p-6">
                            {projectsLoading ? (
                                <div style={{ textAlign: 'center', paddingTop: '80px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading projects…</div>
                            ) : projects.length === 0 ? (
                                <div style={{ textAlign: 'center', paddingTop: '80px', color: 'var(--text-muted)', fontSize: '14px' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.3 }}>📁</div>
                                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>No projects yet</div>
                                    <div style={{ fontSize: '12px', opacity: 0.7 }}>Create a project to organise your conversations</div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', maxWidth: '960px', margin: '0 auto' }}>
                                    {projects.map(p => {
                                        const convCount = Object.values(convProjects).filter(v => v === p.id).length;
                                        const fileCount = (projectFiles[p.id] ?? []).length;
                                        return (
                                            <div key={p.id}
                                                style={{ borderRadius: '12px', background: 'var(--bg-secondary)', border: `1px solid var(--border-default)`, padding: '20px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}
                                                onClick={() => { setActiveProjectDetail(p.id); setProjectDetailTab('overview'); void loadProjectDetail(p.id); }}>
                                                {/* Logo */}
                                                <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: p.color, marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
                                                    {p.emoji ?? '📁'}
                                                </div>
                                                <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px' }}>{p.name}</div>
                                                {p.description && (
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                                                        {p.description}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', gap: '10px' }}>
                                                    <span>💬 {convCount} chat{convCount !== 1 ? 's' : ''}</span>
                                                    <span>📄 {fileCount} file{fileCount !== 1 ? 's' : ''}</span>
                                                </div>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); void deleteProject(p.id); }}
                                                    style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.3, padding: '2px 4px' }}
                                                    title="Delete project">🗑️</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        // ── Project detail view ──────────────────────────────
                        (() => {
                            const proj = projects.find(p => p.id === activeProjectDetail);
                            if (!proj) return null;
                            const files = projectFiles[activeProjectDetail] ?? [];
                            const projConvs = Object.entries(convProjects)
                                .filter(([, pid]) => pid === activeProjectDetail)
                                .map(([cid]) => conversations.find(c => c.id === cid))
                                .filter(Boolean);

                            const isEditing = editingProject?.id === activeProjectDetail;

                            return (
                                <div className="flex flex-1 overflow-hidden">
                                    {/* Left sidebar - project info */}
                                    <div style={{ width: '300px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', padding: '24px', overflowY: 'auto', flexShrink: 0 }}>
                                        {/* Emoji/colour editor */}
                                        <div style={{ position: 'relative', marginBottom: '20px' }}>
                                            <div
                                                style={{ width: '64px', height: '64px', borderRadius: '16px', background: isEditing ? (editingProject.color ?? proj.color) : proj.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', cursor: isEditing ? 'pointer' : 'default', border: isEditing ? '2px dashed rgba(255,255,255,0.2)' : 'none' }}
                                                onClick={() => isEditing && setShowEmojiPicker(v => !v)}
                                                title={isEditing ? 'Click to change emoji' : ''}>
                                                {(isEditing ? editingProject.emoji : proj.emoji) ?? '📁'}
                                            </div>

                                            {/* Emoji picker dropdown */}
                                            {isEditing && showEmojiPicker && (
                                                <div style={{ position: 'absolute', top: '70px', left: 0, zIndex: 100, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '10px', width: '220px' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>Choose emoji</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                                                        {['📁','🚀','💡','🎯','🔧','📊','🤖','🧪','💻','🎨','📝','⚡','🔬','🌐','🏗️','🎮','📈','🛡️','🔑','💎'].map(em => (
                                                            <button key={em} type="button"
                                                                style={{ fontSize: '20px', padding: '4px', background: editingProject?.emoji === em ? 'var(--accent-glow)' : 'none', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                                onClick={() => { setEditingProject(prev => prev ? { ...prev, emoji: em } : prev); setShowEmojiPicker(false); }}>
                                                                {em}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>Colour</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                        {['#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899','#f59e0b','#06b6d4','#ef4444','#84cc16','#6366f1'].map(c => (
                                                            <button key={c} type="button"
                                                                style={{ width: '24px', height: '24px', borderRadius: '50%', background: c, border: editingProject?.color === c ? '2px solid white' : '2px solid transparent', cursor: 'pointer' }}
                                                                onClick={() => setEditingProject(prev => prev ? { ...prev, color: c } : prev)} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Name */}
                                        {isEditing ? (
                                            <input
                                                style={{ width: '100%', fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '6px 10px', marginBottom: '12px', boxSizing: 'border-box' }}
                                                value={editingProject.name ?? proj.name}
                                                onChange={e => setEditingProject(prev => prev ? { ...prev, name: e.target.value } : prev)}
                                            />
                                        ) : (
                                            <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)', marginBottom: '12px' }}>{proj.name}</div>
                                        )}

                                        {/* Description */}
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Description</div>
                                        {isEditing ? (
                                            <textarea
                                                style={{ width: '100%', fontSize: '12px', color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 10px', marginBottom: '16px', resize: 'vertical', minHeight: '80px', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
                                                placeholder="What is this project about?"
                                                value={editingProject.description ?? ''}
                                                onChange={e => setEditingProject(prev => prev ? { ...prev, description: e.target.value } : prev)}
                                            />
                                        ) : (
                                            <div style={{ fontSize: '13px', color: proj.description ? 'var(--text-secondary)' : 'var(--text-muted)', marginBottom: '16px', fontStyle: proj.description ? 'normal' : 'italic' }}>
                                                {proj.description || 'No description yet'}
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            {isEditing ? (
                                                <>
                                                    <button type="button" className="btn-primary" style={{ padding: '6px 14px', fontSize: '12px', flex: 1 }}
                                                        onClick={() => void saveProjectEdits()}>
                                                        ✓ Save
                                                    </button>
                                                    <button type="button" className="btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}
                                                        onClick={() => { setEditingProject(null); setShowEmojiPicker(false); }}>
                                                        Cancel
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button type="button" className="btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}
                                                        onClick={() => setEditingProject({ id: proj.id, name: proj.name, description: proj.description, ai_instructions: proj.ai_instructions, emoji: proj.emoji, color: proj.color })}>
                                                        ✏️ Edit
                                                    </button>
                                                    <button type="button" onClick={() => { setActiveProjectFilter(proj.id); setShowProjectsPage(false); setActiveProjectDetail(null); }}
                                                        className="btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}>
                                                        Filter chats
                                                    </button>
                                                    <button type="button" className="btn-secondary" style={{ padding: '6px 14px', fontSize: '12px', color: '#f87171' }}
                                                        onClick={() => void deleteProject(proj.id)}>
                                                        🗑️
                                                    </button>
                                                </>
                                            )}
                                        </div>

                                        {/* Stats */}
                                        <div style={{ marginTop: '24px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                <span>Conversations</span><span style={{ color: 'var(--text-primary)' }}>{projConvs.length}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Files</span><span style={{ color: 'var(--text-primary)' }}>{files.length}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right content area */}
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        {/* Tabs */}
                                        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', padding: '0 24px' }}>
                                            {(['overview', 'files', 'instructions'] as const).map(tab => (
                                                <button key={tab} type="button"
                                                    style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', color: projectDetailTab === tab ? 'var(--accent)' : 'var(--text-muted)', borderBottom: projectDetailTab === tab ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}
                                                    onClick={() => setProjectDetailTab(tab)}>
                                                    {tab === 'overview' ? '💬 Chats' : tab === 'files' ? '📄 Files' : '🤖 AI Instructions'}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-6">
                                            {/* OVERVIEW TAB — conversations */}
                                            {projectDetailTab === 'overview' && (
                                                <div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                                                        Conversations in this project
                                                    </div>
                                                    {projConvs.length === 0 ? (
                                                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                                                            <div style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.3 }}>💬</div>
                                                            No conversations assigned yet.<br />
                                                            <span style={{ fontSize: '12px', opacity: 0.7 }}>Use the project dropdown in the sidebar to assign chats.</span>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {projConvs.map(c => c && (
                                                                <div key={c.id}
                                                                    style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                                                    onClick={() => { setShowProjectsPage(false); setActiveProjectDetail(null); void openConversation(c.id); }}>
                                                                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{titles[c.id] ?? c.title ?? c.id.slice(0, 8)}</span>
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(c.updated_at).toLocaleDateString()}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* FILES TAB */}
                                            {projectDetailTab === 'files' && (
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                            Upload text/code files as context for this project
                                                        </div>
                                                        <label style={{ cursor: 'pointer' }}>
                                                            <input type="file" className="hidden"
                                                                accept=".ts,.tsx,.js,.jsx,.py,.sql,.md,.txt,.json,.yaml,.yml,.sh,.csv"
                                                                multiple
                                                                onChange={async (e) => {
                                                                    const files = Array.from(e.target.files ?? []);
                                                                    for (const f of files) await uploadProjectFile(activeProjectDetail!, f);
                                                                    e.target.value = '';
                                                                }} />
                                                            <span className="btn-primary" style={{ padding: '6px 14px', fontSize: '12px' }}>+ Add files</span>
                                                        </label>
                                                    </div>

                                                    {files.length === 0 ? (
                                                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                                                            <div style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.3 }}>📄</div>
                                                            No files yet.<br />
                                                            <span style={{ fontSize: '12px', opacity: 0.7 }}>Files are included as context when you chat in this project.</span>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {files.map(f => (
                                                                <div key={f.id} style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <div>
                                                                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>{f.name}</div>
                                                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                                            {f.file_type.toUpperCase()} · {(f.size_bytes / 1024).toFixed(1)}KB · {new Date(f.created_at).toLocaleDateString()}
                                                                        </div>
                                                                    </div>
                                                                    <button type="button"
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.4, padding: '4px' }}
                                                                        onClick={() => void removeProjectFile(activeProjectDetail!, f.id)}>
                                                                        🗑️
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* AI INSTRUCTIONS TAB */}
                                            {projectDetailTab === 'instructions' && (
                                                <div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                                                        These instructions are prepended to every AI message in this project, like a system prompt.
                                                    </div>
                                                    <textarea
                                                        style={{ width: '100%', minHeight: '300px', fontSize: '13px', color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '12px', fontFamily: 'DM Sans, sans-serif', resize: 'vertical', lineHeight: '1.6', boxSizing: 'border-box' }}
                                                        placeholder={"Example:\n- Always respond in Pine Script v5\n- Prefer efficiency over readability\n- When I say 'fix it', look for the most likely error first"}
                                                        value={isEditing ? (editingProject.ai_instructions ?? '') : (proj.ai_instructions ?? '')}
                                                        onChange={e => {
                                                            if (!isEditing) {
                                                                setEditingProject({ id: proj.id, name: proj.name, description: proj.description, ai_instructions: e.target.value, emoji: proj.emoji, color: proj.color });
                                                            } else {
                                                                setEditingProject(prev => prev ? { ...prev, ai_instructions: e.target.value } : prev);
                                                            }
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                                        <button type="button" className="btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }}
                                                            onClick={() => {
                                                                if (!editingProject) {
                                                                    setEditingProject({ id: proj.id, name: proj.name, description: proj.description, ai_instructions: proj.ai_instructions, emoji: proj.emoji, color: proj.color });
                                                                }
                                                                void saveProjectEdits();
                                                            }}>
                                                            Save instructions
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()
                    )}
                </div>
            )}

            {sidebarOpen && (
                <>
                    <aside
                        style={{ width: sidebarWidth, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)' }}
                        className="p-3 overflow-y-auto shrink-0 flex flex-col gap-3"
                    >
                        <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <div className="flex items-center gap-2">
                                <Image src="/t4n-logo.png" alt="T4N" width={22} height={22} className="h-5 w-5 object-contain opacity-90" />
                                <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                    Conversations
                                </span>
                            </div>
                            <button type="button" className="btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => void startNewChat()}>
                                + New
                            </button>
                        </div>

                        {/* Projects bar */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button type="button" onClick={() => setShowProjectsPage(true)}
                                style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                📁 Projects
                            </button>
                            {activeProjectFilter && (
                                <button type="button" onClick={() => setActiveProjectFilter(null)}
                                    style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', border: `1px solid ${projects.find(p => p.id === activeProjectFilter)?.color ?? 'var(--accent)'}`, background: 'transparent', color: projects.find(p => p.id === activeProjectFilter)?.color ?? 'var(--accent)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                    ✕ {projects.find(p => p.id === activeProjectFilter)?.name}
                                </button>
                            )}
                        </div>

                        <input
                            className="w-full rounded border px-3 py-2 text-sm focus-tangerine"
                            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                            placeholder="Search…"
                            value={convSearch}
                            onChange={(e) => setConvSearch(e.target.value)}
                        />

                        <ul className="space-y-0.5 text-sm flex-1">
                            {conversations.length === 0 ? (
                                <li style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px 4px' }}>No conversations yet</li>
                            ) : (
                                filteredConversations
                                    .filter(c => activeProjectFilter ? convProjects[c.id] === activeProjectFilter : true)
                                    .map((c) => {
                                    const projId = convProjects[c.id];
                                    const proj = projects.find(p => p.id === projId);
                                    return (
                                    <li
                                        key={c.id}
                                        className={`cursor-pointer select-none rounded-md px-2 py-2 ${activeId === c.id ? "active-tangerine" : "conversation-item"}`}
                                        style={{ color: activeId === c.id ? 'var(--accent)' : 'var(--text-secondary)' }}
                                        onClick={() => { router.push(`/?c=${encodeURIComponent(c.id)}`); void openConversation(c.id); }}
                                    >
                                        <div className="flex items-center justify-between gap-2 group">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {proj && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: proj.color, flexShrink: 0, display: 'inline-block' }} title={proj.name} />}
                                                <span className="truncate" style={{ fontSize: '13px' }}>
                                                    {titles[c.id] ?? c.title ?? c.id.slice(0, 8)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <div className="hidden group-hover:flex items-center gap-1">
                                                    <button type="button"
                                                        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', color: 'var(--text-secondary)' }}
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleRenameConversation(c.id); }}>
                                                        ✏️
                                                    </button>
                                                    <select
                                                        style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-hover)', color: 'var(--text-secondary)', cursor: 'pointer', maxWidth: '80px' }}
                                                        value={convProjects[c.id] ?? ""}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => { e.stopPropagation(); assignToProject(c.id, e.target.value || null); }}
                                                        title="Assign to project"
                                                    >
                                                        <option value="">No project</option>
                                                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                    </select>
                                                    <button type="button"
                                                        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', color: 'var(--text-secondary)' }}
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDeleteConversation(c.id); }}>
                                                        🗑️
                                                    </button>
                                                </div>
                                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                    {new Date(c.updated_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                    </li>
                                    );
                                })
                            )}
                        </ul>
                    </aside>

                    <div
                        className="w-1 cursor-col-resize"
                        style={{ background: 'var(--border-subtle)' }}
                        onPointerDown={() => { draggingRef.current = "sidebar"; }}
                    />
                </>
            )}

            <main className="flex-1 flex flex-col">
                <div className="p-3 text-sm flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                    <button type="button" className="btn-secondary" style={{ padding: '5px 12px', fontSize: '12px' }}
                        onClick={() => setSidebarOpen((v) => !v)}
                        title={sidebarOpen ? "Hide conversations" : "Show conversations"}>
                        {sidebarOpen ? "← Hide" : "☰ Chats"}
                    </button>

                    <button type="button" className="btn-secondary" style={{ padding: '5px 12px', fontSize: '12px' }}
                        onClick={() => setSettingsOpen(true)}>
                        ⚙ Settings
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                        {activeId && (
                            <button type="button" className="btn-secondary" style={{ padding: '5px 12px', fontSize: '12px' }}
                                onClick={() => void refreshPluginRuns(activeId)}>
                                ↺ Runs
                            </button>
                        )}
                        <button type="button"
                            style={{
                                padding: '5px 14px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer',
                                fontFamily: 'DM Sans, sans-serif', fontWeight: 500, transition: 'all 0.15s',
                                background: codeOpen ? 'var(--accent-glow)' : 'var(--bg-elevated)',
                                color: codeOpen ? 'var(--accent)' : 'var(--text-secondary)',
                                border: codeOpen ? '1px solid rgba(249,115,22,0.3)' : '1px solid var(--border-default)',
                            }}
                            onClick={() => setCodeOpen((v) => !v)}>
                            {codeOpen ? "✕ Code" : `⌨ Code${hasUnsavedChanges ? ' •' : ''}`}
                        </button>
                    </div>
                </div>

                {settingsOpen && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
                        onMouseDown={() => setSettingsOpen(false)}
                    >
                        <div
                            style={{ width: '720px', maxWidth: '95vw', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>Settings</span>
                                <button type="button" className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setSettingsOpen(false)}>✕ Close</button>
                            </div>

                            <div className="flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                {(['prompts', 'plugins', 'appearance'] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveSettingsTab(tab)}
                                        style={{
                                            padding: '10px 20px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            background: 'none',
                                            border: 'none',
                                            fontFamily: 'DM Sans, sans-serif',
                                            transition: 'all 0.15s',
                                            color: activeSettingsTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                                            borderBottom: activeSettingsTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                                        }}
                                    >
                                        {tab === 'prompts' ? 'Prompt Settings' : tab === 'plugins' ? 'Plugins' : 'Appearance'}
                                    </button>
                                ))}
                            </div>

                            <div className="p-4">
                                {activeSettingsTab === 'prompts' && (
                                    <div className="space-y-3">
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Code Generation Display</p>
                                        {([
                                            { value: 'description', label: 'Detailed Description', desc: 'Shows a summary of what changed in each response' },
                                            { value: 'minimal', label: 'Minimal', desc: 'Shows only the code-ready hint' },
                                        ] as const).map(({ value, label, desc }) => (
                                            <label key={value} className="flex items-start gap-3 p-3 cursor-pointer rounded-lg"
                                                style={{ border: `1px solid ${promptDisplayMode === value ? 'rgba(249,115,22,0.4)' : 'var(--border-default)'}`, background: promptDisplayMode === value ? 'var(--accent-glow)' : 'var(--bg-elevated)' }}>
                                                <input type="radio" name="promptMode" value={value} checked={promptDisplayMode === value} onChange={() => setPromptDisplayMode(value)} style={{ accentColor: 'var(--accent)', marginTop: '2px' }} />
                                                <div>
                                                    <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>{label}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{desc}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}

                                {activeSettingsTab === 'appearance' && (
                                    <div className="space-y-3">
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Theme</p>
                                        <div className="flex gap-3">
                                            {([
                                                { value: 'dark', label: 'Dark', preview: ['#0f0f11', '#1e1e24', '#f97316'] },
                                                { value: 'light', label: 'Light', preview: ['#ffffff', '#f0f0f0', '#f97316'] },
                                            ] as const).map(({ value, label, preview }) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() => setTheme(value)}
                                                    style={{
                                                        flex: 1, padding: '16px', borderRadius: '10px', cursor: 'pointer',
                                                        border: `2px solid ${theme === value ? 'var(--accent)' : 'var(--border-default)'}`,
                                                        background: theme === value ? 'var(--accent-glow)' : 'var(--bg-elevated)',
                                                        transition: 'all 0.15s',
                                                    }}
                                                >
                                                    {/* Mini preview */}
                                                    <div style={{ borderRadius: '6px', overflow: 'hidden', marginBottom: '10px', border: '1px solid var(--border-subtle)' }}>
                                                        <div style={{ background: preview[0], padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: preview[2] }} />
                                                            <div style={{ height: '4px', borderRadius: '2px', background: preview[1], flex: 1 }} />
                                                        </div>
                                                        <div style={{ background: preview[1], padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <div style={{ height: '4px', borderRadius: '2px', background: preview[2], width: '60%' }} />
                                                            <div style={{ height: '3px', borderRadius: '2px', background: value === 'dark' ? '#333' : '#ddd', width: '80%' }} />
                                                            <div style={{ height: '3px', borderRadius: '2px', background: value === 'dark' ? '#333' : '#ddd', width: '50%' }} />
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, color: theme === value ? 'var(--accent)' : 'var(--text-primary)', textAlign: 'center' }}>
                                                        {label}
                                                    </div>
                                                    {theme === value && (
                                                        <div style={{ fontSize: '11px', color: 'var(--accent)', textAlign: 'center', marginTop: '4px' }}>✓ Active</div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeSettingsTab === 'plugins' && (
                                    <div className="space-y-3">
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Run Plugin</p>
                                        <div className="flex items-center gap-2">
                                            <select className="border rounded px-2 py-1" value={pluginName}
                                                onChange={(e) => setPluginName(e.target.value as "healthcheck" | "summariseConversation" | "exportConversation")}
                                                disabled={pluginBusy}>
                                                <option value="healthcheck">healthcheck</option>
                                                <option value="summariseConversation">summariseConversation</option>
                                                <option value="exportConversation">exportConversation</option>
                                            </select>
                                            <button type="button" className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
                                                onClick={() => void runSelectedPlugin()} disabled={pluginBusy}>
                                                {pluginBusy ? "Running…" : "▶ Run"}
                                            </button>
                                        </div>

                                        {pluginRuns.length > 0 && (
                                            <div className="space-y-1 mt-2">
                                                <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent runs</p>
                                                {pluginRuns.slice(0, 5).map((r) => (
                                                    <div key={r.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5"
                                                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontSize: '12px' }}>
                                                        <div className="truncate">
                                                            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{r.pluginName}</span>
                                                            <span style={{ color: 'var(--text-muted)' }}> — {r.status}</span>
                                                            {r.error && <span style={{ color: '#f87171' }}> — {r.error}</span>}
                                                        </div>
                                                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{r.createdAt}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-3 text-sm flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                        <span style={{ color: '#f87171', fontWeight: 500 }}>⚠ {error}</span>
                        <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', marginLeft: 'auto', flexShrink: 0 }}
                            onClick={() => { cancelStreamSilently(); void retryLastSend(); }}>
                            ↺ Retry
                        </button>
                    </div>
                )}

                <div className="flex-1 flex overflow-hidden">
                    {/* Chat area */}
                    <div className="flex-1 p-5 overflow-y-auto space-y-4 relative" style={{ background: 'var(--bg-primary)' }}>
                        <Image
                            src="/t4n-logo.png"
                            alt=""
                            width={256}
                            height={256}
                            className="pointer-events-none select-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2"
                            style={{ opacity: 0.03 }}
                            priority={false}
                        />

                        {loading && (
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--accent)', animationDelay: '0ms' }}></div>
                                    <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--accent)', animationDelay: '150ms' }}></div>
                                    <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--accent)', animationDelay: '300ms' }}></div>
                                </div>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>T4N is thinking…</span>
                            </div>
                        )}

                        {messages.length === 0 && (
                            <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
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
                                <div key={m.id} className={`max-w-2xl ${isUser ? "ml-auto" : ""}`}>
                                    <div
                                        className={`whitespace-pre-wrap break-words ${isUser
                                            ? "message-user p-3 selection-blue"
                                            : isStopped
                                                ? "glass p-3"
                                                : "message-assistant p-3"
                                            }`}
                                        style={isStopped && !isUser ? { borderLeft: '2px solid var(--accent)' } : {}}
                                    >
                                        {!isUser && isStopped && (
                                            <div className="mb-1" style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Stopped</div>
                                        )}
                                        {(() => {
                                            if (!/ctrl\+f:/i.test(cleanText)) return cleanText;

                                            // Parse into prose and Ctrl+F instruction blocks
                                            const lines = cleanText.split('\n');
                                            const segments: React.ReactNode[] = [];
                                            let i = 0;
                                            let segKey = 0;

                                            while (i < lines.length) {
                                                const line = lines[i];

                                                // Detect start of a Ctrl+F block
                                                if (/^ctrl\+f:/i.test(line.trim())) {
                                                    // Extract the FIND value (rest of this line, strip backticks/fences)
                                                    const findVal = line.replace(/^ctrl\+f:\s*/i, '').replace(/```[\w]*/g, '').trim();
                                                    const findLines = findVal ? [findVal] : [];
                                                    i++;

                                                    // Collect continuation lines until "Replace with:" or blank+next-instruction
                                                    while (i < lines.length && !/^replace with:/i.test(lines[i].trim()) && !/^ctrl\+f:/i.test(lines[i].trim()) && !/^add (above|below):/i.test(lines[i].trim())) {
                                                        const l = lines[i].replace(/```[\w]*/g, '').replace(/^```$/, '').trim();
                                                        if (l) findLines.push(l);
                                                        i++;
                                                    }

                                                    // Detect action type
                                                    let actionLabel = 'REPLACE';
                                                    if (i < lines.length && /^replace with:/i.test(lines[i].trim())) {
                                                        actionLabel = 'REPLACE';
                                                    } else if (i < lines.length && /^add above:/i.test(lines[i].trim())) {
                                                        actionLabel = 'ADD ABOVE';
                                                    } else if (i < lines.length && /^add below:/i.test(lines[i].trim())) {
                                                        actionLabel = 'ADD BELOW';
                                                    }
                                                    i++; // skip the "Replace with:" line

                                                    // Collect replace lines
                                                    const replaceLines: string[] = [];
                                                    while (
                                                        i < lines.length &&
                                                        (
                                                            (!/^ctrl\+f:/i.test(lines[i].trim()) && !/^```$/.test(lines[i].trim())) ||
                                                            (lines[i].trim() === "```" && replaceLines.length === 0)
                                                        )
                                                    ) {
                                                        const l = lines[i].replace(/```[\w]*/g, "").replace(/^```$/, "");
                                                        // Stop at closing fence only after we have content
                                                        if (lines[i].trim() === "```" && replaceLines.length > 0) { i++; break; }
                                                        if (l.trim() || replaceLines.length > 0) replaceLines.push(l);
                                                        i++;
                                                    }

                                                    const findText = findLines.join('\n').trim();
                                                    const replaceText = replaceLines.join('\n').trim();

                                                    segments.push(
                                                        <div key={segKey++} style={{ margin: '10px 0' }}>
                                                            {/* FIND box */}
                                                            <div style={{ borderRadius: '6px 6px 0 0', overflow: 'hidden', border: '1px solid rgba(249,115,22,0.35)', borderBottom: 'none' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: 'rgba(249,115,22,0.1)' }}>
                                                                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>FIND</span>
                                                                    <button type="button"
                                                                        style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(249,115,22,0.3)', background: copiedBlockId === `find-${segKey}` ? 'rgba(249,115,22,0.25)' : 'transparent', color: copiedBlockId === `find-${segKey}` ? '#fff' : 'var(--accent)', cursor: 'pointer', transition: 'all 0.2s' }}
                                                                        onClick={async () => { try { await navigator.clipboard.writeText(findText); setCopiedBlockId(`find-${segKey}`); setTimeout(() => setCopiedBlockId(null), 1500); highlightInCanvas(findText); } catch { } }}>
                                                                        {copiedBlockId === `find-${segKey}` ? '✓ Copied' : 'Copy'}
                                                                    </button>
                                                                </div>
                                                                <pre style={{ margin: 0, padding: '8px 10px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#e2e2e8', background: '#0d0d10', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{findText}</pre>
                                                            </div>
                                                            {/* REPLACE/ADD box */}
                                                            <div style={{ borderRadius: '0 0 6px 6px', overflow: 'hidden', border: '1px solid rgba(99,102,241,0.35)' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: 'rgba(99,102,241,0.1)' }}>
                                                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{actionLabel}</span>
                                                                    <button type="button"
                                                                        style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(99,102,241,0.3)', background: copiedBlockId === `replace-${segKey}` ? 'rgba(99,102,241,0.25)' : 'transparent', color: copiedBlockId === `replace-${segKey}` ? '#fff' : '#818cf8', cursor: 'pointer', transition: 'all 0.2s' }}
                                                                        onClick={async () => { try { await navigator.clipboard.writeText(replaceText); setCopiedBlockId(`replace-${segKey}`); setTimeout(() => setCopiedBlockId(null), 1500); } catch { } }}>
                                                                        {copiedBlockId === `replace-${segKey}` ? '✓ Copied' : 'Copy'}
                                                                    </button>
                                                                </div>
                                                                <pre style={{ margin: 0, padding: '8px 10px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#e2e2e8', background: '#0d0d10', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{replaceText || '(empty — delete the found line)'}</pre>
                                                            </div>
                                                        </div>
                                                    );
                                                } else {
                                                    // Prose line — strip backtick fences, collect until next ctrl+f
                                                    const proseLine = line.replace(/```[\w]*/g, '').replace(/^```$/, '').trim();
                                                    if (proseLine) segments.push(<div key={segKey++} style={{ marginBottom: '4px', fontSize: '13px', color: 'var(--text-primary)' }}>{proseLine}</div>);
                                                    i++;
                                                }
                                            }

                                            return segments;
                                        })()}

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
                            className="max-w-[45vw] flex flex-col shrink-0 overflow-hidden"
                            style={{ width: codeWidth, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-subtle)' }}
                        >
                            <div className="flex items-center gap-2 p-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {/* New Code Button */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{ padding: '4px 10px', fontSize: '12px' }}
                                        onClick={handleNewCode}
                                        title="Create new code"
                                    >
                                        📄 New
                                    </button>

                                    {/* Undo Button */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{
                                            padding: '4px 10px',
                                            fontSize: '12px',
                                            opacity: historyIndex > 0 ? 1 : 0.5
                                        }}
                                        onClick={handleUndo}
                                        disabled={historyIndex <= 0}
                                        title="Undo"
                                    >
                                        ↩ Undo
                                    </button>

                                    {/* Redo Button */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{
                                            padding: '4px 10px',
                                            fontSize: '12px',
                                            opacity: historyIndex < codeHistory.length - 1 ? 1 : 0.5
                                        }}
                                        onClick={handleRedo}
                                        disabled={historyIndex >= codeHistory.length - 1}
                                        title="Redo"
                                    >
                                        ↪ Redo
                                    </button>

                                    {/* Save Button - UPDATED to update current snippet */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{
                                            padding: '4px 10px',
                                            fontSize: '12px',
                                            background: hasUnsavedChanges ? 'rgba(34,197,94,0.1)' : undefined
                                        }}
                                        onClick={() => {
                                            if (activeCodeId) {
                                                // Update existing snippet (keeps same ID)
                                                updateActiveSnippet();
                                                setHasUnsavedChanges(false);
                                            } else if (hasUnsavedChanges) {
                                                // Save as new snippet
                                                saveCurrentCode();
                                                setHasUnsavedChanges(false);
                                                setUnsavedCode("");
                                            }
                                        }}
                                        disabled={!codeText.trim() || !hasUnsavedChanges}
                                        title={activeCodeId ? "Save changes to current snippet" : "Save as new snippet"}
                                    >
                                        {activeCodeId ? "Update" : "Save"}
                                    </button>

                                    {/* Copy Button */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{ padding: '4px 10px', fontSize: '12px' }}
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


                                    <div className="flex items-center gap-2">
                                        <select
                                            className="border rounded px-2 py-1 text-sm"
                                            value={activeCodeId ?? (hasUnsavedChanges ? UNSAVED_ID : "")}
                                            onChange={async (e) => {
                                                const id = e.target.value || null;

                                                // Handle unsaved selection
                                                if (id === UNSAVED_ID) {
                                                    setActiveCodeId(null);
                                                    setCodeText(unsavedCode);
                                                    setGiveAiAccessToCode(false);
                                                    setShowVersions(false);
                                                    return;
                                                }

                                                // If we had unsaved changes, ask user before switching
                                                if (hasUnsavedChanges && codeText !== unsavedCode) {
                                                    const confirmSwitch = confirm(
                                                        "You have unsaved changes. Switch to saved snippet anyway?"
                                                    );
                                                    if (!confirmSwitch) {
                                                        // Reset dropdown to current selection
                                                        e.target.value = activeCodeId ?? (hasUnsavedChanges ? UNSAVED_ID : "");
                                                        return;
                                                    }
                                                }

                                                setActiveCodeId(id);
                                                setGiveAiAccessToCode(false);
                                                setHasUnsavedChanges(false); // Switching to saved snippet clears unsaved flag

                                                const found = savedCodes.find((s) => s.id === id);
                                                if (found && id) {
                                                    setCodeText(found.code);
                                                    addToHistory(found.code); // Add to history
                                                    await loadVersions(id);
                                                }
                                            }}
                                        >
                                            <option value="">Saved snippets…</option>
                                            {hasUnsavedChanges && (
                                                <option value={UNSAVED_ID}>📝 Unsaved (new)</option>
                                            )}
                                            {savedCodes.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name} {activeCodeId === s.id && hasUnsavedChanges ? '✏️' : ''}
                                                </option>
                                            ))}
                                        </select>

                                        <button
                                            type="button"
                                            className="btn-secondary"
                                            style={{
                                                padding: '4px 10px', fontSize: '12px',
                                                ...(giveAiAccessToCode ? { background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.4)', color: '#4ade80' } : {})
                                            }}
                                            disabled={!activeCodeId}
                                            title={
                                                !activeCodeId
                                                    ? "Select a saved snippet first"
                                                    : giveAiAccessToCode
                                                        ? "AI sees first ~200 lines. For deep changes, describe the section by name (e.g. 'edit the ENTRY CONDITIONS section')"
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
                                                    // Lock the snippet id + code at the moment access is granted
                                                    setAccessLockedSnippetId(activeCodeId);
                                                    setAccessLockedCode(codeText);
                                                    return;
                                                }

                                                // turning off
                                                setGiveAiAccessToCode(false);
                                                setAccessLockedSnippetId(null);
                                                setAccessLockedCode("");
                                            }}
                                        >
                                            {giveAiAccessToCode ? "Access: ON" : "Give access"}
                                        </button>
                                    </div>

                                    {activeCodeId && (
                                        <>
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                                onClick={() => {
                                                    if (!activeCodeId) return;
                                                    renameSnippet(activeCodeId);
                                                }}
                                            >
                                                Rename
                                            </button>

                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px', color: '#f87171' }}
                                                onClick={() => {
                                                    if (activeCodeId) {
                                                        void deleteSnippet(activeCodeId);
                                                    }
                                                }}
                                            >
                                                Delete
                                            </button>

                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                                onClick={async () => {
                                                    const newState = !showVersions;
                                                    setShowVersions(newState);
                                                    if (newState && activeCodeId) {
                                                        await loadVersions(activeCodeId);
                                                    }
                                                }}
                                            >
                                                History {snippetVersions.length > 0 ? `(${snippetVersions.length})` : ''}
                                            </button>

                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="p-3 overflow-y-auto pb-8">
                                {codeText ? (
                                    <textarea
                                        ref={codeTextareaRef}
                                        className="w-full h-[55vh] whitespace-pre font-mono break-words overflow-auto"
                                        style={{ background: '#0d0d10', color: '#e2e2e8', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '10px', fontSize: '12px', lineHeight: '1.7', fontFamily: 'JetBrains Mono, monospace', resize: 'none' }}
                                        value={codeText}
                                        readOnly={false}
                                        placeholder="Paste code here or wait for AI to generate..."
                                        onChange={(e) => {
                                            const newValue = e.target.value;
                                            setCodeText(newValue);
                                            addToHistory(newValue); // Add to history on manual edit
                                            if (activeCodeId) {
                                                setHasUnsavedChanges(true);
                                            } else if (newValue.trim()) {
                                                setUnsavedCode(newValue);
                                                setHasUnsavedChanges(true);
                                                setActiveCodeId(null);
                                            }
                                        }}
                                        onPaste={(e) => {
                                            const pastedText = e.clipboardData?.getData("text") ?? "";
                                            setTimeout(() => {
                                                if (pastedText.trim()) {
                                                    setUnsavedCode(pastedText);
                                                    setHasUnsavedChanges(true);
                                                    setActiveCodeId(null);
                                                    addToHistory(pastedText); // Add to history on paste
                                                }
                                            }, 0);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Tab") {
                                                e.preventDefault();
                                                const el = e.currentTarget;
                                                const start = el.selectionStart ?? 0;
                                                const end = el.selectionEnd ?? 0;
                                                const insert = "  "; // 2 spaces
                                                const next = codeText.slice(0, start) + insert + codeText.slice(end);
                                                setCodeText(next);
                                                addToHistory(next); // Add to history on tab
                                                requestAnimationFrame(() => {
                                                    el.selectionStart = el.selectionEnd = start + insert.length;
                                                });
                                            }
                                        }}
                                    />
                                ) : (
                                    <div style={{ padding: '24px 0', textAlign: 'center' }}>
                                        <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>⌨</div>
                                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>No code yet</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.7 }}>
                                            Paste code here, ask the AI, or type directly
                                        </div>
                                    </div>
                                )}

                                {showVersions && activeCodeId && (
                                    <div className="mt-2 pt-2 pb-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Version History</h4>
                                            <button
                                                type="button"
                                                style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                                                onClick={() => setShowVersions(false)}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        {loadingSnippets ? (
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px 0' }}>Loading...</div>
                                        ) : snippetVersions.length > 0 ? (
                                            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                                                {snippetVersions.map((version) => (
                                                    <div
                                                        key={version.id}
                                                        className="group relative"
                                                        style={{ fontSize: '12px', padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: '6px', background: 'var(--bg-elevated)' }}
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <div
                                                                className="flex-1 cursor-pointer"
                                                                onClick={async () => {
                                                                    if (!activeCodeId) return;
                                                                    if (confirm(`Restore version ${version.version_number}?`)) {
                                                                        try {
                                                                            setLoadingSnippets(true);
                                                                            const res = await restoreSnippetVersion(activeCodeId, version.version_number);

                                                                            if (res.ok) {
                                                                                const snippetsRes = await getSnippets();
                                                                                if (snippetsRes.ok) setSavedCodes(snippetsRes.data.snippets);
                                                                                await loadVersions(activeCodeId);
                                                                                const snippetRes = await getSnippet(activeCodeId);
                                                                                if (snippetRes.ok) {
                                                                                    // Load restored code WITHOUT adding to history (avoids creating a new version entry)
                                                                                    setCodeText(snippetRes.data.snippet.code);
                                                                                    setHasUnsavedChanges(false);
                                                                                }
                                                                            }
                                                                        } catch (error) {
                                                                            console.error("Error restoring version:", error);
                                                                        } finally {
                                                                            setLoadingSnippets(false);
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                <div className="flex justify-between">
                                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>v{version.version_number}</span>
                                                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                                        {new Date(version.created_at).toLocaleDateString()}
                                                                    </span>
                                                                </div>
                                                                <div className="truncate pr-12" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                                    {version.change_summary || version.source}
                                                                </div>
                                                            </div>

                                                            <div className="hidden group-hover:flex items-center gap-0.5 ml-1 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '2px 5px', fontSize: '10px', cursor: 'pointer' }}
                                                                    title="Edit description"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        const newSummary = prompt("Edit description:", version.change_summary || "");
                                                                        if (newSummary !== null) {
                                                                            alert("Version description update coming soon!");
                                                                        }
                                                                    }}
                                                                >
                                                                    ✏️
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '2px 5px', fontSize: '10px', cursor: 'pointer', color: '#f87171' }}
                                                                    title="Delete version"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm(`Delete version ${version.version_number}?`)) {
                                                                            alert("Version deletion coming soon!");
                                                                        }
                                                                    }}
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px 0' }}>No history</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </aside>
                    )}
                </div>


                {/* ALWAYS SHOW COMPOSER */}
                <form
                    className="p-3 flex gap-2"
                    style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSend();
                    }}
                >
                    <div className="flex-1 flex flex-col gap-2">
                        {attachments.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                {attachments.map((a) => (
                                    <div key={a.id} className="flex items-center gap-2 rounded p-1" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
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
                                            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}
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
                            className="w-full"
                            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px 14px', color: 'var(--text-primary)', fontSize: '13px' }}
                            placeholder="Message T4N…"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onPaste={(e) => {
                                const items = Array.from(e.clipboardData?.items ?? []);
                                const files = items
                                    .map((it) => (it.kind === "file" ? it.getAsFile() : null))
                                    .filter((f): f is File => !!f && f.type.startsWith("image/"));

                                if (files.length > 0) {
                                    e.preventDefault();
                                    void handleAttachArray(files);
                                    return;
                                }

                                // Detect code pasted as text — if it looks like code, route it to the code panel
                                const text = e.clipboardData?.getData("text") ?? "";
                                const looksLikeCode =
                                    /```[\s\S]*```/.test(text) ||
                                    /(^|\n)\s*\/\/@version=\d+/i.test(text) ||
                                    /(^|\n)\s*(indicator|strategy|function|const |let |var |def |import |export |class )\s*/m.test(text) ||
                                    (text.includes("{") && text.includes("}") && text.split("\n").length > 4);

                                if (looksLikeCode && text.trim().length > 80) {
                                    e.preventDefault();
                                    // Put it in the code panel as unsaved, open the panel
                                    setCodeText(text);
                                    setUnsavedCode(text);
                                    setHasUnsavedChanges(true);
                                    setActiveCodeId(null);
                                    setCodeOpen(true);
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
