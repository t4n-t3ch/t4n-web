"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { Session } from "@supabase/supabase-js";
import Image from "next/image";
import MonacoEditor from "@monaco-editor/react";
import type * as Monaco from 'monaco-editor';
import DiffViewer from 'react-diff-viewer-continued';
import { lintCode, severityIcon, severityColor, type Diagnostic } from '@/lib/linter';
import {
    listConversations,
    getMessages,
    createConversation,
    streamMessage,
    executePlugin,
    getPluginRuns,
    renameConversation,
    assignConversationToProject,
    seedConversation,
    sendMessage as apiSendMessage,
    deleteConversation,
    createBillingPortalSession,
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
    // type ProjectFile as ApiProjectFile, // removed unused import
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

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    return isMobile;
}

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType; }

function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    let nextId = 0;
    const showToast = (message: string, type: ToastType = 'success') => {
        const id = ++nextId;
        setToasts(t => [...t, { id, message, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
    };
    const ToastContainer = () => (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
            {toasts.map(toast => (
                <div key={toast.id} style={{
                    padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    fontFamily: 'DM Sans, sans-serif', maxWidth: 320, pointerEvents: 'auto',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                    background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : toast.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)',
                    border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : toast.type === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.4)'}`,
                    color: toast.type === 'success' ? '#34d399' : toast.type === 'error' ? '#f87171' : '#fb923c',
                    animation: 'toastIn 0.2s ease',
                }}>
                    {toast.type === 'success' ? '✓ ' : toast.type === 'error' ? '⚠ ' : 'ℹ '}{toast.message}
                </div>
            ))}
            <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
    return { showToast, ToastContainer };
}

export default function HomeClient() {
    const { showToast, ToastContainer } = useToast();
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
    const isMobile = useIsMobile();
    const [mobileTab, setMobileTab] = useState<'chat' | 'code' | 'sessions' | 'projects'>('chat');
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

    const [userPlan, setUserPlan] = useState<'free' | 'pro'>('free');
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeSettingsTab, setActiveSettingsTab] = useState<'prompts' | 'plugins' | 'appearance' | 'billing' | 'contact' | 'howto'>('prompts');

    const [, setPluginResult] = useState<unknown>(null);
    const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);
    const [appliedBlockId, setAppliedBlockId] = useState<string | null>(null);
    const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
    const [exportDropdownPos, setExportDropdownPos] = useState({ top: 0, left: 0 });
    const [convertDropdownOpen, setConvertDropdownOpen] = useState(false);
    const [convertDropdownPos, setConvertDropdownPos] = useState({ top: 0, left: 0 });
    const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);
    const [actionsDropdownPos, setActionsDropdownPos] = useState({ top: 0, left: 0 });
    const [proToolsDropdownOpen, setProToolsDropdownOpen] = useState(false);
    const [proToolsDropdownPos, setProToolsDropdownPos] = useState({ top: 0, left: 0 });
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
    const [showNewProjectModal, setShowNewProjectModal] = useState(false);
    const [newProjectMode, setNewProjectMode] = useState<'manual' | 'ai_tree'>('manual');
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectPrompt, setNewProjectPrompt] = useState('');
    const [newProjectLoading, setNewProjectLoading] = useState(false);
    const [generatingBranches, setGeneratingBranches] = useState<Set<string>>(new Set());
    const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

    // =========================
    // Layout: resizable panels
    // =========================
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(288); // px (w-72)
    const [codeWidth, setCodeWidth] = useState(420); // px
    const [fileTreeOpen, setFileTreeOpen] = useState(true);
    const [fileTreeWidth, setFileTreeWidth] = useState(220); // px
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const draggingRef = useRef<null | "sidebar" | "code" | "filetree">(null);

    // Explorer overlay menus
    type ExplorerOverlay =
        | { type: 'add-file'; projectId: string }
        | { type: 'link-chat'; projectId: string }
        | null;
    const [explorerOverlay, setExplorerOverlay] = useState<ExplorerOverlay>(null);
    const [newFileName, setNewFileName] = useState('');
    const [inlineNewFile, setInlineNewFile] = useState<{ projectId: string } | null>(null);
    const [inlineNewFileName, setInlineNewFileName] = useState('');
    const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
    const [renamingFileValue, setRenamingFileValue] = useState('');

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

            if (draggingRef.current === "filetree") {
                const next = Math.max(160, Math.min(400, e.clientX - sidebarWidth));
                setFileTreeWidth(next);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const [activeCodeId, setActiveCodeId] = useState<string | null>(() => {
        try { return localStorage.getItem('t4n_active_code_id') || null; } catch { return null; }
    });
    const [giveAiAccessToCode, setGiveAiAccessToCode] = useState(false);
    const [, setAccessLockedSnippetId] = useState<string | null>(null);
    const [accessLockedCode, setAccessLockedCode] = useState<string>("");
    const [loadingSnippets, setLoadingSnippets] = useState(false);
    const [snippetVersions, setSnippetVersions] = useState<SnippetVersion[]>([]);
    const [showVersions, setShowVersions] = useState(false);
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
    const [showDiffView, setShowDiffView] = useState(false);
    const [renameModalId, setRenameModalId] = useState<string | null>(null);
    const [renameModalValue, setRenameModalValue] = useState('');

    // Monaco editor state
    const [useMonaco, setUseMonaco] = useState(false);
    const [monacoMinimap, setMonacoMinimap] = useState(false);
    const [monacoTheme, setMonacoTheme] = useState<'vs-dark' | 'light' | 'hc-black'>('vs-dark');
    const [openTabs, setOpenTabs] = useState<string[]>([]); // snippet ids open as tabs
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const monacoEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoInstanceRef = useRef<typeof Monaco | null>(null);

    // Diagnostics panel
    const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [diagnosticsFilter, setDiagnosticsFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

    // Prompt Preset Library
    type PromptPreset = {
        id: string;
        name: string;
        prompt: string;
        createdAt: number;
    };

    const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetModalMode, setPresetModalMode] = useState<'save' | 'manage'>('save');
    const [editingPreset, setEditingPreset] = useState<PromptPreset | null>(null);
    const [presetNameInput, setPresetNameInput] = useState('');
    const [presetPromptInput, setPresetPromptInput] = useState('');

    // Load presets from localStorage
    useEffect(() => {
        try {
            const stored = localStorage.getItem('t4n_prompt_presets');
            if (stored) {
                setPromptPresets(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load presets:', e);
        }
    }, []);

    // Save presets to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('t4n_prompt_presets', JSON.stringify(promptPresets));
        } catch (e) {
            console.error('Failed to save presets:', e);
        }
    }, [promptPresets]);

    // Domain / language selection
    const [selectedDomain, setSelectedDomain] = useState<string>('auto');

    // Inline AI code actions
    const [inlineActionBusy, setInlineActionBusy] = useState(false);
    const [inlineActionLabel, setInlineActionLabel] = useState<string | null>(null);

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
                    // Restore previously active snippet
                    const savedId = localStorage.getItem('t4n_active_code_id');
                    if (savedId) {
                        const found = res.data.snippets.find((s: Snippet) => s.id === savedId);
                        if (found) {
                            setActiveCodeId(found.id);
                            setCodeText(found.code);
                        }
                    }
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

    useEffect(() => {
        try {
            if (activeCodeId) localStorage.setItem('t4n_active_code_id', activeCodeId);
            else localStorage.removeItem('t4n_active_code_id');
        } catch { /* ignore */ }
    }, [activeCodeId]);

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

    async function saveCurrentCode(overrideName?: string) {
        if (!codeText.trim()) return;
        if (activeCodeId) return;

        const detectedLang = detectLanguage(codeText);
        const name = overrideName?.trim() || `Snippet ${savedCodes.length + 1}`;

        try {
            const res = await createSnippet({
                name,
                language: detectedLang,
                code: codeText,
                source: 'user_edit'
            });

            if (res.ok) {
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

    function promptSaveCurrentCode() {
        if (!codeText.trim() || activeCodeId) return;
        setRenameModalId('__new__');
        setRenameModalValue('');
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
        setRenameModalId(id);
        setRenameModalValue(current);
    }

    async function commitRename() {
        const id = renameModalId;
        const next = renameModalValue.trim();
        setRenameModalId(null);
        setRenameModalValue('');
        if (!id || !next) return;

        // Special case: saving new unsaved code with a name
        if (id === '__new__') {
            await saveCurrentCode(next);
            return;
        }

        // Optimistic update
        setSavedCodes((p) => p.map((x) => (x.id === id ? { ...x, name: next } : x)));

        try {
            const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
            const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            const token = currentSession?.access_token ?? "";
            const res = await fetch(`${API_BASE}/api/snippets/${encodeURIComponent(id)}/rename`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "Authorization": `Bearer ${token}` },
                body: JSON.stringify({ name: next }),
            });
            if (!res.ok) {
                console.error("Rename PATCH failed:", res.status, await res.text());
            }
            if (!res.ok) {
                // Fallback to updateSnippet
                const current = savedCodes.find((s) => s.id === id);
                if (current) await updateSnippet(id, { code: current.code, change_summary: 'Rename', source: 'user_edit', name: next } as Parameters<typeof updateSnippet>[1]);
            }
        } catch (err) {
            console.error("Rename failed:", err);
        }
        // Re-fetch but ONLY replace state if DB confirms the new name
        try {
            const snippetsRes = await getSnippets();
            if (snippetsRes.ok) {
                const confirmed = snippetsRes.data.snippets.find((s: Snippet) => s.id === id);
                if (confirmed?.name === next) setSavedCodes(snippetsRes.data.snippets);
            }
        } catch (e) {
            console.error("Failed to refresh after rename:", e);
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

    function detectLanguage(code: string): string {
        if (/#property\s+(copyright|strict|indicator|version)|OnTick\(\)|OnInit\(\)|OnStart\(\)/i.test(code)) return 'mql5';
        if (/using\s+cAlgo|cAlgo\.API/i.test(code)) return 'ctrader';
        if (/using\s+UnityEngine|MonoBehaviour/i.test(code)) return 'unity';
        if (/import\s+bpy\b|bpy\.ops\.|bpy\.data\./i.test(code)) return 'blender';
        if (/(^|\n)\s*\/\/@version=\d+/i.test(code) || /(^|\n)\s*(indicator|strategy)\s*\(/i.test(code)) return 'pinescript';
        if (/import\s+React|from\s+['"]react['"]|useState\b|useEffect\b|useRef\b|JSX\.Element|React\.FC/.test(code)) return 'react';
        if (/from\s+['"][^'"]+['"]|interface\s+\w+\s*{|type\s+\w+\s*=|:\s*(string|number|boolean|void)\b/.test(code)) return 'typescript';
        if (/def\s+\w+\s*\(|^import\s+\w+\s*$/m.test(code)) return 'python';
        if (/function\s+\w+\s*\(|const\s+\w+\s*=\s*(async\s*)?\(|=>\s*{/.test(code)) return 'javascript';
        return 'generic';
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

    function runDiagnostics(code: string) {
        const results = lintCode(code, selectedDomain === 'auto' ? detectLanguage(code) : selectedDomain);
        setDiagnostics(results);
        if (results.length > 0 && results.some(d => d.severity === 'error' || d.severity === 'warning')) {
            setDiagnosticsOpen(true);
        }
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

            // Don't prepend anything that could break Pine's required first line (//@version=5)
            const shouldAnnotateLang = !!lang && lang !== "pinescript" && lang !== "pine";

            blocks.push(`${shouldAnnotateLang ? `// ${langRaw}\n` : ""}${body}`);
        }

        if (blocks.length > 0) {
            // If multiple blocks, take only the LAST one (most complete/final version)
            return blocks[blocks.length - 1];
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

    async function openBillingPortal() {
        try {
            const res = await createBillingPortalSession();
            if (!res.ok) throw new Error(res.error);
            if (res.data.url) window.location.href = res.data.url;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to open billing portal");
        }
    }

    async function startCheckout() {
        if (!session) return;
        try {
            setCheckoutLoading(true);
            const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
            const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";
            const token = session.access_token;
            const res = await fetch(`${API_BASE}/api/billing/create-checkout-session`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": API_KEY,
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Checkout failed");
        } finally {
            setCheckoutLoading(false);
        }
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


    const fetchUserPlan = async (accessToken: string, keepOnFailure = false) => {
        const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
        const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";
        const delays = [0, 3000, 8000, 15000, 25000];
        for (const delay of delays) {
            try {
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
                const res = await fetch(`${API_BASE}/api/whoami`, {
                    headers: { "x-api-key": API_KEY, "Authorization": `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(30000), // 30s per attempt for Render cold starts
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.plan) { setUserPlan(data.plan); return; }
                }
            } catch { /* retry */ }
        }
        // All retries exhausted — only downgrade if not keepOnFailure
        if (!keepOnFailure) {
            setUserPlan(prev => prev === 'pro' ? 'pro' : 'free');
        }
    };

    useEffect(() => {
        if (!session) return;
        void refreshConversations();
        void syncProjectsFromApi();
        void fetchUserPlan(session.access_token);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    // Re-fetch plan when user returns from Stripe billing page
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && session) {
                void fetchUserPlan(session.access_token, true);
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
                if (t) setTitles((prev) => prev[id] ? prev : ({ ...prev, [id]: t }));

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
        console.log("🔍 readSseStream started, response OK:", res.ok);

        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            console.log("🔴 Response not OK:", { status: res.status, text });
            if (res.status === 402) {
                const e = new Error("Free plan limit reached. Upgrade to continue.") as Error & { status?: number };
                e.status = 402;
                throw e;
            }
            throw new Error(text || res.statusText || `Request failed (${res.status})`);
        }

        console.log("🔍 Response body exists, starting to read stream");

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
            let frameCount = 0;

            while (true) {
                if (signal?.aborted) {
                    console.log("🔍 Stream aborted by signal");
                    return;
                }

                const { value, done } = await reader.read();
                if (done) {
                    console.log("🔍 Stream reading done");
                    break;
                }

                if (signal?.aborted) return;

                const chunk = decoder.decode(value, { stream: true });
                console.log(`🔍 Received chunk #${frameCount++}:`, chunk.substring(0, 100) + (chunk.length > 100 ? '...' : ''));

                buf += chunk;

                let idx: number;
                while ((idx = buf.indexOf("\n\n")) !== -1) {
                    if (signal?.aborted) return;

                    const frame = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);

                    console.log("🔍 Raw frame:", frame);

                    let event = "message";
                    let dataStr = "";

                    for (const line of frame.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim();
                        if (line.startsWith("data:")) dataStr += line.slice(5).trim();
                    }

                    console.log(`🔍 Parsed event: ${event}, data:`, dataStr.substring(0, 100));

                    if (!dataStr) continue;

                    const data = (() => {
                        try {
                            return JSON.parse(dataStr);
                        } catch {
                            console.log("🔴 Failed to parse JSON:", dataStr);
                            return null;
                        }
                    })();

                    if (event === "meta" && onMeta) onMeta((data || {}) as StreamMeta);
                    if (event === "tool" && onTool) onTool((data || {}) as ToolEvent);
                    if (event === "delta" && data?.delta) onDelta(String(data.delta));
                    if (event === "done") onDone((data || {}) as StreamDone);

                    if (event === "ping") continue;

                    if (event === "error") {
                        console.log("🔴 ERROR EVENT DETECTED! Full data:", data);

                        const err = (data || {}) as StreamError;
                        const msg = err.details || err.error || "Stream error";

                        // Log the full error for debugging
                        console.log("🔴 SSE Error received:", {
                            event,
                            data,
                            msg,
                            status: (data as Record<string, unknown>)?.status,
                            code: (data as Record<string, unknown>)?.code,
                            error: (data as Record<string, unknown>)?.error
                        });

                        // Check for payment required error using multiple signals
                        const is402 =
                            // Check status field if present
                            (data as { status?: number } | null)?.status === 402 ||
                            (data as { code?: string } | null)?.code === "PAYMENT_REQUIRED" ||
                            (data as { error?: string } | null)?.error === "PAYMENT_REQUIRED" ||
                            // Check for 402 in message
                            msg.includes("402") ||
                            // Check for PAYMENT_REQUIRED string
                            msg.includes("PAYMENT_REQUIRED") ||
                            // Check exact error message from enforceUsageOrThrow
                            msg === "Free plan limit reached. Upgrade to continue." ||
                            // Check for variations of the message
                            msg.toLowerCase().includes("free plan limit") ||
                            msg.toLowerCase().includes("upgrade to continue") ||
                            msg.toLowerCase().includes("payment required") ||
                            msg.toLowerCase().includes("quota");

                        console.log("🔴 Is paywall?", { is402, msg });

                        if (is402) {
                            console.log("🔴 THROWING PAYWALL ERROR");
                            const e = new Error(msg) as Error & { status?: number; code?: string };
                            e.status = 402;
                            e.code = "PAYMENT_REQUIRED";
                            throw e;
                        }
                        throw new Error(msg);
                    }
                }
            }
        } catch (error) {
            console.log("🔴 Exception in readSseStream:", error);
            throw error;
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

            const projectContext = buildProjectContext();

            const finalText = (wantsCodeRef.current || (giveAiAccessToCode && codeForContext.trim()))
                ? `USER REQUEST:
${payload.text}${codeContext ? `

${codeContext}` : ""}${projectContext}`
                : `${payload.text}${projectContext}`;

            const codeToSend = undefined;
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

                        // Never mark unsaved or clear activeCodeId when AI edits an existing snippet
                        if (!activeCodeId) {
                            setUnsavedCode(merged);
                            setHasUnsavedChanges(true);
                        } else {
                            // Keep activeCodeId intact — don't drift to "Snippet N"
                            setHasUnsavedChanges(true);
                        }

                        if (giveAiAccessToCode) {
                            setAccessLockedCode(merged);
                        }

                        setCodeOpen((v) => (v ? v : true));
                    }

                    // HARD RULE: if ANY code detected, chat shows ONLY the hint (no code, no mixed text)
                    // Set a simple neutral description when code is first detected
                    // Determine what message to show
                    let messageToShow = "";
                    const isCtrlFResponse = /ctrl\+f:/i.test(streamed);
                    const prose = stripCodeBlocks(streamed).trim();

                    if (isCtrlFResponse) {
                        messageToShow = streamed; // Ctrl+F renderer handles it
                    } else if (extracted && promptDisplayMode === 'description') {
                        // Show [Code generated] header + actual AI prose description
                        messageToShow = prose
                            ? `[Code generated → open the Code panel]\n\n${prose}`
                            : "[Code generated → open the Code panel]";
                    } else if (extracted) {
                        messageToShow = "[Code generated → open the Code panel]";
                    } else {
                        messageToShow = prose || stripCodeBlocks(streamed);
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

            // Use locked snapshot if available, otherwise fall back to live codeText
            const codeForContext = (giveAiAccessToCode && accessLockedCode)
                ? accessLockedCode
                : codeText;
            const trimmedForPrompt = codeForContext.slice(0, 120000);
            const codeContext =
                giveAiAccessToCode && codeForContext.trim()
                    ? `\n\nEXISTING CODE (you MUST either output the FULL corrected file OR give Ctrl+F find-and-replace instructions — NEVER output a partial truncated file):\n\`\`\`pinescript\n${trimmedForPrompt}\n\`\`\`\n`
                    : "";

            const projectContext = buildProjectContext();

            const finalText = (wantsCodeRef.current || (giveAiAccessToCode && codeForContext.trim()))
                ? `USER REQUEST:
${payload.text}${codeContext ? `

${codeContext}` : ""}${projectContext}`
                : `${payload.text}${projectContext}`;

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

                        // Never mark unsaved or clear activeCodeId when AI edits an existing snippet
                        if (!activeCodeId) {
                            setUnsavedCode(merged);
                            setHasUnsavedChanges(true);
                        } else {
                            // Keep activeCodeId intact — don't drift to "Snippet N"
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
                    // Determine what message to show
                    let messageToShow = "";
                    const isCtrlFResponse = /ctrl\+f:/i.test(streamed);
                    const prose = stripCodeBlocks(streamed).trim();

                    if (isCtrlFResponse) {
                        messageToShow = streamed; // Ctrl+F renderer handles it
                    } else if (extracted && promptDisplayMode === 'description') {
                        // Show [Code generated] header + actual AI prose description
                        messageToShow = prose
                            ? `[Code generated → open the Code panel]\n\n${prose}`
                            : "[Code generated → open the Code panel]";
                    } else if (extracted) {
                        messageToShow = "[Code generated → open the Code panel]";
                    } else {
                        messageToShow = prose || stripCodeBlocks(streamed);
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
            const status = (err as Error & { status?: number })?.status;
            const code = (err as Error & { code?: string })?.code;

            // Check for payment required error (usage limits)
            const isPaywall =
                status === 402 ||
                code === "PAYMENT_REQUIRED" ||
                code === "TOPIC_RESTRICTED" ||
                msg.includes("402") ||
                msg.includes("PAYMENT_REQUIRED") ||
                msg.includes("UPGRADE_REQUIRED") ||
                msg === "Free plan limit reached. Upgrade to continue." ||
                msg.toLowerCase().includes("free plan limit") ||
                msg.toLowerCase().includes("upgrade to continue") ||
                msg.toLowerCase().includes("payment required") ||
                msg.toLowerCase().includes("quota") ||
                msg.toLowerCase().includes("pro feature");

            if (isPaywall) {
                // Show appropriate message based on error type
                if (msg.toLowerCase().includes("pro feature") || code === "TOPIC_RESTRICTED") {
                    alert("✨ This feature requires a Pro subscription. Please upgrade to access it.");
                } else {
                    alert("⚠️ You've reached your free message limit. Please upgrade to Pro to continue chatting.");
                }
                setShowUpgradeModal(true);
            } else {
                setError(friendlyError(msg));
                setMessages((m) => [
                    ...m,
                    { id: globalThis.crypto.randomUUID(), role: "assistant", content: `⚠️ ${friendlyError(msg)}` },
                ]);
            }
        } finally {
            setLoading(false);
            setStreaming(false);
        }

    }

    if (authLoading) return (
        <div className="flex h-screen items-center justify-center" style={{ background: '#0f0f11' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#f97316', letterSpacing: '-0.5px' }}>T4N</div>
                <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: '3px solid #2a2a35',
                    borderTop: '3px solid #f97316',
                    animation: 'spin 0.8s linear infinite',
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ fontSize: 13, color: '#6b7280' }}>Loading your workspace…</div>
            </div>
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
                    onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                            setAuthError(null);
                            if (authMode === "login") {
                                const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
                                if (error) setAuthError(error.message);
                            } else {
                                const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
                                if (error) setAuthError(error.message);
                                else setAuthError("✅ Check your email to confirm your account before signing in.");
                            }
                        }
                    }}
                    style={{ width: '100%', background: '#0f0f11', border: '1px solid #2a2a35', borderRadius: 6, padding: '10px 12px', color: '#e2e2e8', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
                />
                {authMode === "login" && (
                    <div style={{ textAlign: 'right', marginBottom: 12 }}>
                        <button
                            type="button"
                            style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
                            onClick={async () => {
                                if (!authEmail.trim()) { setAuthError("Enter your email above first."); return; }
                                setAuthError(null);
                                const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
                                    redirectTo: `${window.location.origin}/reset-password`,
                                });
                                if (error) setAuthError(error.message);
                                else setAuthError("✅ Password reset email sent — check your inbox.");
                            }}
                        >
                            Forgot password?
                        </button>
                    </div>
                )}
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
                            else setAuthError("✅ Check your email to confirm your account before signing in.");
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

                {/* Google OAuth — coming soon */}
            </div>
        </div>
    );

    const PROJECT_COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444'];

    function createProject() {
        setNewProjectName('');
        setNewProjectPrompt('');
        setNewProjectMode('manual');
        setShowNewProjectModal(true);
    }

    async function submitNewProject() {
        if (newProjectMode === 'manual') {
            if (!newProjectName.trim()) return;
            setShowNewProjectModal(false);
            const name = newProjectName.trim();
            const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
            const emoji = '📁';
            const tempId = globalThis.crypto.randomUUID();
            const project: Project = { id: tempId, name, description: null, ai_instructions: null, emoji, color, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            setProjects(p => [...p, project]);
            try {
                const res = await apiCreateProject({ name, emoji, color });
                if (res.ok) setProjects(p => p.map(x => x.id === tempId ? { ...x, id: res.data.id } : x));
            } catch (e) { console.error("Failed to create project:", e); }
        } else {
            // AI Tree mode
            if (!newProjectPrompt.trim()) return;
            setNewProjectLoading(true);
            try {
                const res = await fetch(`${(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "")}/api/anthropic`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.NEXT_PUBLIC_API_KEY || "dev-key-123",
                        'Authorization': `Bearer ${((await supabase.auth.getSession()).data.session?.access_token ?? "")}`,
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 1000,
                        messages: [{
                            role: 'user',
                            content: `You are a project scaffolding assistant. Given a project description, return ONLY a JSON object (no markdown, no backticks) with this shape:
{
  "name": "Short project name",
  "emoji": "relevant emoji",
  "description": "One sentence description",
  "ai_instructions": "Domain-specific AI instructions for this project type",
  "branches": [
    { "title": "Branch name", "description": "What this branch covers" },
    ...
  ]
}
Generate 3-6 branches representing the major functional areas of the project. Branch names should be specific and code-relevant (e.g. "Player Controller", "Enemy AI", "Inventory System").
Project description: ${newProjectPrompt.trim()}`
                        }]
                    })
                });
                const data = await res.json();
                const text = (data.content || []).map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join('');
                const clean = text.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(clean);
                const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
                setShowNewProjectModal(false);
                setNewProjectLoading(false);
                // Create the parent project
                const projRes = await apiCreateProject({
                    name: parsed.name,
                    emoji: parsed.emoji ?? '🗂️',
                    color,
                    description: parsed.description ?? null,
                    ai_instructions: parsed.ai_instructions ?? null,
                });
                if (!projRes.ok) return;
                const projectId = projRes.data.id;
                setProjects(p => [...p, { id: projectId, name: parsed.name, description: parsed.description ?? null, ai_instructions: parsed.ai_instructions ?? null, emoji: parsed.emoji ?? '🗂️', color, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
                // Set filter NOW so sidebar shows branches with spinners during generation
                setActiveProjectFilter(projectId);
                // Create a conversation branch for each section
                // Detect language once from the project description + AI instructions
                const instrLower = (parsed.ai_instructions ?? '' + newProjectPrompt).toLowerCase();
                const lang = instrLower.includes('unity') || instrLower.includes('c#') ? 'C# for Unity'
                    : instrLower.includes('python') ? 'Python'
                    : instrLower.includes('pine') || instrLower.includes('tradingview') ? 'Pine Script v5'
                    : instrLower.includes('react') || instrLower.includes('next') ? 'TypeScript React'
                    : instrLower.includes('javascript') ? 'JavaScript'
                    : instrLower.includes('blender') ? 'Python for Blender (bpy)'
                    : 'TypeScript';
                const ext = lang.includes('C#') ? 'cs'
                    : lang.includes('Python') ? 'py'
                    : lang.includes('Pine') ? 'pine'
                    : 'ts';

                for (const branch of (parsed.branches ?? [])) {
                    try {
                        const convRes = await createConversation();
                        if (convRes?.ok) {
                            const convId = convRes.data.conversationId;
                            await assignConversationToProject(convId, projectId);
                            setConversations(prev => [{ id: convId, title: branch.title, updated_at: new Date().toISOString() }, ...prev]);
                            setTitles(prev => ({ ...prev, [convId]: branch.title }));
                            setConvProjects(prev => ({ ...prev, [convId]: projectId }));
                            setGeneratingBranches(prev => new Set([...prev, convId]));

                            // Step 1: Generate code via /api/anthropic
                            const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
                            const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-key-123";
                            const { data: { session: sess } } = await supabase.auth.getSession();
                            const token = sess?.access_token ?? "";

                            const codeRes = await fetch(`${API_BASE}/api/anthropic`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Authorization': `Bearer ${token}` },
                                body: JSON.stringify({ messages: [{ role: 'user', content: `Generate a complete, well-commented ${lang} starter file for the "${branch.title}" module of "${parsed.name}".${branch.description ? ` This covers: ${branch.description}.` : ''} Include placeholder functions with clear TODO comments. Output ONLY the raw ${lang} code, no explanation, no markdown fences.` }] })
                            });
                            const codeData = await codeRes.json();
                            const rawCode = ((codeData.content || []).map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join(''))
                                .replace(/^```[\w]*\n?/gm, '').replace(/^```$/gm, '').trim();

                            // Step 2: Save as named project file
                            const fileName = branch.title.replace(/[^a-zA-Z0-9]/g, '') + '.' + ext;
                            if (rawCode) {
                                await apiAddProjectFile(projectId, { name: fileName, content: rawCode, file_type: ext });
                            }

                            // Step 3: Generate a clean summary for the chat opening
                            const summaryRes = await fetch(`${API_BASE}/api/anthropic`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Authorization': `Bearer ${token}` },
                                body: JSON.stringify({ messages: [{ role: 'user', content: `In 2-3 sentences, describe what the "${branch.title}" module does in "${parsed.name}" and list 3 specific things the developer can ask you to implement or improve. Be direct and practical. No code.` }] })
                            });
                            const summaryData = await summaryRes.json();
                            const summary = (summaryData.content || []).map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join('').trim();

                            // Step 4: Seed chat with clean opening message
                            await seedConversation(convId, {
                                userMessage: `Set up the ${branch.title} module for ${parsed.name}`,
                                assistantMessage: `✅ **${fileName}** has been created and added to your project files.\n\n${summary || `This is your ${branch.title} starter file. Open it from the Code Files panel and ask me to implement any part of it.`}`,
                            });

                            // Step 5: Rename last so it is the final DB write
                            await renameConversation(convId, branch.title);
                            setTitles(prev => ({ ...prev, [convId]: branch.title }));
                            setGeneratingBranches(prev => { const n = new Set(prev); n.delete(convId); return n; });
                        }
                    } catch (e) {
                        console.error('Branch creation failed:', e);
                    }
                }
                setActiveProjectFilter(projectId);
                // Force reload files from DB — optimistic state may be stale after file creation
                await loadProjectDetail(projectId);
                setExpandedProjects(prev => ({ ...prev, [projectId]: true }));
            } catch (e) {
                console.error('AI tree generation failed:', e);
                setNewProjectLoading(false);
                setShowNewProjectModal(false);
                showToast('AI tree generation failed. Please try again.', 'error');
            }
        }
    }

    function deleteProject(id: string) {
        setDeleteProjectId(id);
    }

    async function confirmDeleteProject() {
        const id = deleteProjectId;
        if (!id) return;
        setDeleteProjectId(null);
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
        const fileType = ['ts', 'tsx', 'js', 'jsx', 'py', 'sql', 'md', 'txt', 'json', 'yaml', 'yml', 'sh'].includes(ext) ? ext : 'text';

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

    function savePreset(name: string, prompt: string) {
        if (!name.trim() || !prompt.trim()) return;

        const newPreset: PromptPreset = {
            id: crypto.randomUUID(),
            name: name.trim(),
            prompt: prompt.trim(),
            createdAt: Date.now(),
        };

        setPromptPresets(prev => [...prev, newPreset]);
        setShowPresetModal(false);
        setPresetNameInput('');
        setPresetPromptInput('');
    }

    function deletePreset(id: string) {
        if (!confirm('Delete this preset?')) return;
        setPromptPresets(prev => prev.filter(p => p.id !== id));
    }

    function _usePreset(preset: PromptPreset) {
        // Inject the preset into the conversion flow
        // This will be used when the user clicks a preset
        setInput(preset.prompt);
    }

    function _getVersionById(id: string): SnippetVersion | undefined {
        return snippetVersions.find(v => v.id === id);
    }

    function formatVersionSource(source: string): string {
        const sources: Record<string, string> = {
            'ai_generated': 'AI',
            'user_edit': 'Manual',
            'import': 'Import',
            'restore': 'Restore'
        };
        return sources[source] || source;
    }

    function getVersionNumberById(id: string): number {
        const version = snippetVersions.find(v => v.id === id);
        return version?.version_number || 0;
    }

    function formatCode(code: string, domain: string): string {
        const lines = code.split('\n');
        const result: string[] = [];
        let indentLevel = 0;
        const indent = (n: number) => '    '.repeat(Math.max(0, n));

        if (domain === 'pinescript') {
            // Pine Script: indent inside if/for/while/switch blocks
            for (const raw of lines) {
                const line = raw.trimEnd();
                const trimmed = line.trim();
                if (!trimmed) { result.push(''); continue; }

                // Decrease indent before closing keywords
                if (/^(else|else if|switch)\b/.test(trimmed)) {
                    indentLevel = Math.max(0, indentLevel - 1);
                }

                result.push(indent(indentLevel) + trimmed);

                // Increase indent after opening keywords
                if (/^(if |for |while |switch |else\b|else if )/.test(trimmed) && !trimmed.endsWith('=>')) {
                    indentLevel++;
                } else if (trimmed.endsWith('=>')) {
                    indentLevel++;
                }
            }
            return result.join('\n');
        }

        if (domain === 'python') {
            // Python: preserve relative indentation, just normalise mixed tabs/spaces
            return lines.map(l => l.replace(/\t/g, '    ').trimEnd()).join('\n');
        }

        if (['typescript', 'react', 'javascript', 'generic', 'ctrader', 'mql5', 'unity', 'blender'].includes(domain)) {
            // Brace-based languages
            for (const raw of lines) {
                const line = raw.trimEnd();
                const trimmed = line.trim();
                if (!trimmed) { result.push(''); continue; }

                const closingBraces = (trimmed.match(/^[}\])]/) ? 1 : 0);
                if (closingBraces) indentLevel = Math.max(0, indentLevel - 1);

                result.push(indent(indentLevel) + trimmed);

                const opens = (trimmed.match(/[{[(]/g) || []).length;
                const closes = (trimmed.match(/[}\])]/g) || []).length;
                indentLevel = Math.max(0, indentLevel + opens - closes - closingBraces);
            }
            return result.join('\n');
        }

        // Fallback: just trim trailing whitespace
        return lines.map(l => l.trimEnd()).join('\n');
    }

    function buildProjectContext(): string {
        const activeConvProjectId = activeId ? convProjects[activeId] : null;
        const proj = projects.find(p => p.id === activeConvProjectId);
        if (!proj) return '';

        const parts: string[] = [];
        parts.push(`PROJECT: ${proj.name}`);
        if (proj.description) parts.push(`DESCRIPTION: ${proj.description}`);
        if (proj.ai_instructions?.trim()) parts.push(`PROJECT INSTRUCTIONS (follow these always):\n${proj.ai_instructions.trim()}`);
        parts.push(`LANGUAGE/DOMAIN: ${selectedDomain === 'auto' ? detectLanguage(codeText) : selectedDomain}`);

        const files = projectFiles[proj.id] ?? [];
        if (files.length > 0) {
            parts.push(`PROJECT FILES: ${files.map(f => f.name).join(', ')}`);
        }

        return `\n\n[PROJECT CONTEXT]\n${parts.join('\n')}\n[END PROJECT CONTEXT]`;
    }

    if (isMobile) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-primary)', overflow: 'hidden' }}>

                {/* ── SESSIONS TAB ── */}
                {mobileTab === 'sessions' && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Image src="/t4n-logo.png" alt="T4N" width={22} height={22} className="h-5 w-5 object-contain opacity-90" />
                                <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>Chats</span>
                            </div>
                            <button type="button"
                                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                onClick={async () => { await startNewChat(); setMobileTab('chat'); }}>
                                + New
                            </button>
                        </div>

                        <input
                            style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px 14px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }}
                            placeholder="Search conversations…"
                            value={convSearch}
                            onChange={e => setConvSearch(e.target.value)}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {filteredConversations.map(c => (
                                <div key={c.id}
                                    style={{ padding: '12px 14px', borderRadius: '10px', background: activeId === c.id ? 'var(--accent-glow)' : 'var(--bg-secondary)', border: `1px solid ${activeId === c.id ? 'rgba(249,115,22,0.3)' : 'var(--border-subtle)'}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                    onClick={() => { void openConversation(c.id); setMobileTab('chat'); }}>
                                    <span style={{ fontSize: '13px', color: activeId === c.id ? 'var(--accent)' : 'var(--text-primary)', fontWeight: activeId === c.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                        {titles[c.id] ?? c.title ?? c.id.slice(0, 8)}
                                    </span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                                        {new Date(c.updated_at).toLocaleDateString()}
                                    </span>
                                </div>
                            ))}
                            {filteredConversations.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>No conversations yet</div>
                            )}
                        </div>

                        {/* Settings + account footer */}
                        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {/* Plan badge */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Plan</span>
                                {userPlan === 'pro' ? (
                                    <button type="button"
                                        onClick={() => void openBillingPortal()}
                                        style={{ padding: '4px 12px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#4ade80', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                        ✓ Pro · Manage
                                    </button>
                                ) : (
                                    <button type="button"
                                        onClick={() => setShowUpgradeModal(true)}
                                        style={{ padding: '4px 12px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.08)', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                        Free → Upgrade Pro
                                    </button>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="button"
                                    onClick={() => setSettingsOpen(true)}
                                    style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                    ⚙️ Settings
                                </button>
                                <button type="button"
                                    onClick={async () => { if (confirm('Sign out?')) await supabase.auth.signOut(); }}
                                    style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── CODE TAB ── */}
                {mobileTab === 'code' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {/* Code toolbar */}
                        <div style={{ display: 'flex', gap: '6px', padding: '8px 10px', overflowX: 'auto', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', flexShrink: 0, WebkitOverflowScrolling: 'touch' }}>
                            <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }} onClick={handleNewCode}>📄 New</button>
                            <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', opacity: historyIndex > 0 ? 1 : 0.4 }} onClick={handleUndo} disabled={historyIndex <= 0}>↩ Undo</button>
                            <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', opacity: historyIndex < codeHistory.length - 1 ? 1 : 0.4 }} onClick={handleRedo} disabled={historyIndex >= codeHistory.length - 1}>↪ Redo</button>
                            <button type="button" className="btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', background: hasUnsavedChanges ? 'rgba(34,197,94,0.1)' : undefined }}
                                onClick={() => { if (activeCodeId) { updateActiveSnippet(); setHasUnsavedChanges(false); } else if (hasUnsavedChanges) { promptSaveCurrentCode(); } }}
                                disabled={!codeText.trim() || !hasUnsavedChanges}>
                                {activeCodeId ? 'Update' : 'Save'}
                            </button>
                            <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                                onClick={async () => { try { await navigator.clipboard.writeText(codeText || ''); showToast('Code copied!'); } catch { showToast('Copy failed', 'error'); } }}
                                disabled={!codeText.trim()}>Copy</button>
                            <select value={selectedDomain === 'auto' && codeText.length > 80 ? detectLanguage(codeText) : selectedDomain} onChange={e => { const v = e.target.value; if (v === 'auto') setSelectedDomain(detectLanguage(codeText)); else setSelectedDomain(v); }}
                                style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                <option value="auto">🔍 {codeText.length > 80 ? (() => { const d = detectLanguage(codeText); return d === 'unity' ? 'Unity C#' : d === 'pinescript' ? 'Pine Script' : d === 'python' ? 'Python' : d === 'mql5' ? 'MQL5' : d === 'ctrader' ? 'cTrader' : d === 'react' ? 'React' : d === 'blender' ? 'Blender' : d === 'generic' ? 'Generic' : 'Auto-detect'; })() : 'Auto-detect'}</option>
                                <option value="pinescript">🌲 Pine Script</option>
                                <option value="ctrader">📊 cTrader</option>
                                <option value="python">🐍 Python</option>
                                <option value="mql5">⚙️ MQL5</option>
                                <option value="react">⚛️ React</option>
                                <option value="blender">🎨 Blender</option>
                                <option value="unity">🎮 Unity</option>
                                <option value="generic">💻 Generic</option>
                            </select>
                        </div>

                        {/* Snippet selector */}
                        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
                            <select
                                style={{ width: '100%', fontSize: '13px', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'DM Sans, sans-serif' }}
                                value={activeCodeId ?? (hasUnsavedChanges ? UNSAVED_ID : '')}
                                onChange={async e => {
                                    const id = e.target.value || null;
                                    if (id === UNSAVED_ID) { setActiveCodeId(null); setCodeText(unsavedCode); return; }
                                    setActiveCodeId(id);
                                    setHasUnsavedChanges(false);
                                    const found = savedCodes.find(s => s.id === id);
                                    if (found && id) { setCodeText(found.code); addToHistory(found.code); runDiagnostics(found.code); await loadVersions(id); }
                                }}>
                                <option value="">Saved snippets…</option>
                                {hasUnsavedChanges && <option value={UNSAVED_ID}>📝 Unsaved (new)</option>}
                                {savedCodes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>

                        {/* Code textarea — fills remaining height */}
                        <textarea
                            ref={codeTextareaRef}
                            style={{ flex: 1, background: '#0d0d10', color: '#e2e2e8', border: 'none', padding: '12px', fontSize: '12px', lineHeight: '1.7', fontFamily: 'JetBrains Mono, monospace', resize: 'none', outline: 'none', WebkitOverflowScrolling: 'touch' }}
                            value={codeText}
                            placeholder="Paste or write code here…"
                            onChange={e => {
                                const v = e.target.value;
                                setCodeText(v);
                                addToHistory(v);
                                runDiagnostics(v);
                                if (activeCodeId) { setHasUnsavedChanges(true); }
                                else if (v.trim()) { setUnsavedCode(v); setHasUnsavedChanges(true); setActiveCodeId(null); }
                                if (v.length > 80 && selectedDomain === 'auto') setSelectedDomain(detectLanguage(v));
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Tab') {
                                    e.preventDefault();
                                    const el = e.currentTarget;
                                    const start = el.selectionStart ?? 0;
                                    const end = el.selectionEnd ?? 0;
                                    const next = codeText.slice(0, start) + '  ' + codeText.slice(end);
                                    setCodeText(next);
                                    addToHistory(next);
                                    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
                                }
                            }}
                        />

                        {/* Diagnostics summary bar */}
                        {codeText.trim() && diagnostics.length > 0 && (
                            <div style={{ padding: '6px 10px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', flexShrink: 0 }}
                                onClick={() => { runDiagnostics(codeText); setDiagnosticsOpen(v => !v); }}>
                                {diagnostics.filter(d => d.severity === 'error').length > 0 && (
                                    <span style={{ fontSize: '11px', color: '#f87171' }}>🔴 {diagnostics.filter(d => d.severity === 'error').length} error{diagnostics.filter(d => d.severity === 'error').length !== 1 ? 's' : ''}</span>
                                )}
                                {diagnostics.filter(d => d.severity === 'warning').length > 0 && (
                                    <span style={{ fontSize: '11px', color: '#fbbf24' }}>🟡 {diagnostics.filter(d => d.severity === 'warning').length} warning{diagnostics.filter(d => d.severity === 'warning').length !== 1 ? 's' : ''}</span>
                                )}
                                {diagnostics.length === 0 && <span style={{ fontSize: '11px', color: '#4ade80' }}>✓ No issues</span>}
                            </div>
                        )}
                    </div>
                )}

                {/* ── CHAT TAB ── */}
                {mobileTab === 'chat' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {/* Chat header */}
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {activeId ? (titles[activeId] ?? 'Chat') : 'New chat'}
                            </span>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                {codeText.trim() && (
                                    <button type="button"
                                        style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.08)', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontWeight: 600 }}
                                        onClick={() => setMobileTab('code')}>
                                        ⌨️ Code{hasUnsavedChanges ? ' •' : ''}
                                    </button>
                                )}
                                <button type="button"
                                    style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                    onClick={() => {
                                        if (!giveAiAccessToCode || !activeCodeId) {
                                            if (activeCodeId) {
                                                setGiveAiAccessToCode(true);
                                                setAccessLockedCode(codeText);
                                            }
                                        } else {
                                            setGiveAiAccessToCode(false);
                                            setAccessLockedCode('');
                                        }
                                    }}>
                                    {giveAiAccessToCode ? '🟢 AI' : '⚫ AI'}
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', WebkitOverflowScrolling: 'touch' }}>
                            {loading && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {[0, 150, 300].map(d => <div key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--accent)', animationDelay: `${d}ms` }} />)}
                                    </div>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>T4N is thinking…</span>
                                </div>
                            )}
                            {messages.length === 0 && !loading && (
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{ textAlign: 'center', maxWidth: 300, padding: '0 20px' }}>
                                        <div style={{ fontSize: 28, marginBottom: 10 }}>⚡</div>
                                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>Welcome to T4N</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>AI coding assistant for traders.</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {['🔍 Explain this indicator', '🔧 Fix my Pine Script errors', '🔄 Convert to Python', '🧪 Add alerts to my strategy'].map(s => (
                                                <button key={s} type="button"
                                                    onClick={() => { const el = document.querySelector('input[placeholder="Message T4N…"]') as HTMLInputElement; if (el) { el.value = s; el.focus(); el.dispatchEvent(new Event('input', { bubbles: true })); } }}
                                                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: 'DM Sans, sans-serif' }}
                                                >{s}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {messages.map(m => {
                                const isUser = m.role === 'user';
                                const isActiveStreaming = !isUser && streaming && m.id === activeAssistantIdRef.current;
                                const isStopped = !isUser && /\[Stopped\]\s*$/.test(m.content || '');
                                const cleanText = isStopped ? (m.content || '').replace(/\n?\n?\[Stopped\]\s*$/, '') : (m.content || '');

                                return (
                                    <div key={m.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                                        <div style={{
                                            maxWidth: '85%', padding: '10px 14px', borderRadius: '12px', fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                            background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
                                            color: isUser ? '#fff' : 'var(--text-primary)',
                                            border: isUser ? 'none' : '1px solid var(--border-subtle)',
                                        }}>
                                            {cleanText}{isActiveStreaming ? ' ▍' : ''}
                                        </div>
                                    </div>
                                );
                            })}
                            {error && (
                                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '12px', color: '#f87171' }}>
                                    ⚠️ {error}
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>

                        {/* Composer — sits above tab bar, keyboard pushes it up */}
                        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                            <input
                                ref={inputRef}
                                style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '20px', padding: '10px 16px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                                placeholder="Message T4N…"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                                disabled={loading}
                            />
                            {streaming ? (
                                <button type="button"
                                    style={{ padding: '10px 18px', borderRadius: '20px', background: '#ef4444', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', flexShrink: 0 }}
                                    onClick={stopStreaming}>Stop</button>
                            ) : (
                                <button type="button"
                                    style={{ padding: '10px 18px', borderRadius: '20px', background: input.trim() ? 'var(--accent)' : 'var(--bg-elevated)', border: `1px solid ${input.trim() ? 'transparent' : 'var(--border-default)'}`, color: input.trim() ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                                    onClick={() => void handleSend()}
                                    disabled={loading || !input.trim()}>Send</button>
                            )}
                        </div>
                    </div>
                )}

                {/* ── PROJECTS TAB ── */}
                {mobileTab === 'projects' && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>📁 Projects</span>
                            <button type="button"
                                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                onClick={() => void createProject()}>
                                + New
                            </button>
                        </div>
                        {projects.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>No projects yet</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {projects.map(p => {
                                    const convCount = Object.values(convProjects).filter(v => v === p.id).length;
                                    return (
                                        <div key={p.id}
                                            style={{ padding: '14px', borderRadius: '10px', background: activeProjectFilter === p.id ? 'var(--accent-glow)' : 'var(--bg-secondary)', border: `1px solid ${activeProjectFilter === p.id ? 'rgba(249,115,22,0.3)' : 'var(--border-subtle)'}`, cursor: 'pointer' }}
                                            onClick={() => { setActiveProjectFilter(activeProjectFilter === p.id ? null : p.id); setMobileTab('sessions'); }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                                                    {p.emoji ?? '📁'}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                                    {p.description && <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                                                </div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>{convCount} chat{convCount !== 1 ? 's' : ''}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ── BOTTOM TAB BAR ── */}
                <div style={{
                    display: 'flex',
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--bg-secondary)',
                    flexShrink: 0,
                    paddingBottom: 'env(safe-area-inset-bottom)',
                }}>
                    {([
                        { id: 'chat', icon: '💬', label: 'Chat' },
                        { id: 'code', icon: '⌨️', label: 'Code' },
                        { id: 'projects', icon: '📁', label: 'Projects' },
                        { id: 'sessions', icon: '☰', label: 'Sessions' },
                    ] as const).map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setMobileTab(tab.id)}
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '3px',
                                padding: '10px 0',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontFamily: 'DM Sans, sans-serif',
                                borderTop: mobileTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                                transition: 'all 0.15s',
                            }}
                        >
                            <span style={{ fontSize: '18px' }}>{tab.icon}</span>
                            <span style={{ fontSize: '10px', fontWeight: mobileTab === tab.id ? 700 : 400, color: mobileTab === tab.id ? 'var(--accent)' : 'var(--text-muted)' }}>
                                {tab.label}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Settings modal — must live inside mobile return to be reachable */}
                {settingsOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={() => setSettingsOpen(false)}>
                        <div style={{ width: '720px', maxWidth: '95vw', maxHeight: '90dvh', overflowY: 'auto', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }} onMouseDown={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>Settings</span>
                                <button type="button" className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setSettingsOpen(false)}>✕ Close</button>
                            </div>
                            <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                Open T4N on desktop to access full settings, or use the options below.
                                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {userPlan !== 'pro' && (
                                        <button type="button" onClick={() => { setSettingsOpen(false); setShowUpgradeModal(true); }} style={{ padding: '12px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                            ⚡ Upgrade to Pro
                                        </button>
                                    )}
                                    {userPlan === 'pro' && (
                                        <button type="button" onClick={() => { setSettingsOpen(false); void openBillingPortal(); }} style={{ padding: '12px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                            Manage Billing
                                        </button>
                                    )}
                                    <button type="button" onClick={async () => { if (confirm('Sign out?')) await supabase.auth.signOut(); }} style={{ padding: '12px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                        Sign out
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Delete Project Confirm Modal — mobile */}
                {deleteProjectId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={() => setDeleteProjectId(null)}>
                        <div style={{ width: '380px', maxWidth: '95vw', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }} onMouseDown={e => e.stopPropagation()}>
                            <div style={{ padding: '20px 20px 0' }}>
                                <div style={{ fontSize: '28px', marginBottom: '10px' }}>🗑️</div>
                                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '6px' }}>Delete project?</div>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>This will permanently delete the project and all its files. Conversations will be unassigned but not deleted.</div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', padding: '0 20px 20px', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setDeleteProjectId(null)} style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Cancel</button>
                                <button type="button" onClick={() => void confirmDeleteProject()} style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Delete</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* New Project Modal — needed on mobile too */}
                {showNewProjectModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={() => { if (!newProjectLoading) setShowNewProjectModal(false); }}>
                        <div style={{ width: '460px', maxWidth: '95vw', borderRadius: '14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }} onMouseDown={(e) => e.stopPropagation()}>
                            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>📁 New Project</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Choose how to set up your project</div>
                            </div>
                            <div style={{ padding: '16px 20px 0' }}>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button type="button" onClick={() => setNewProjectMode('manual')} style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: `2px solid ${newProjectMode === 'manual' ? 'var(--accent)' : 'var(--border-default)'}`, background: newProjectMode === 'manual' ? 'rgba(249,115,22,0.08)' : 'var(--bg-elevated)', color: newProjectMode === 'manual' ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
                                        ✏️ Manual
                                        <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>Name it and start fresh</div>
                                    </button>
                                    <button type="button" onClick={() => setNewProjectMode('ai_tree')} style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: `2px solid ${newProjectMode === 'ai_tree' ? 'var(--accent)' : 'var(--border-default)'}`, background: newProjectMode === 'ai_tree' ? 'rgba(249,115,22,0.08)' : 'var(--bg-elevated)', color: newProjectMode === 'ai_tree' ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
                                        🌳 AI Full Tree
                                        <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>AI scaffolds branches for you</div>
                                    </button>
                                </div>
                            </div>
                            <div style={{ padding: '16px 20px 20px' }}>
                                {newProjectMode === 'manual' ? (
                                    <>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Project name</div>
                                        <input autoFocus style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }} placeholder="e.g. Trading Bot, Game Dev, Web App..." value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitNewProject(); if (e.key === 'Escape') setShowNewProjectModal(false); }} />
                                    </>
                                ) : (
                                    <>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Describe your project</div>
                                        <textarea autoFocus style={{ width: '100%', minHeight: '90px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif', resize: 'vertical', lineHeight: '1.5' }} placeholder="e.g. A Unity 2D game with a player, enemies, inventory system, and save/load functionality..." value={newProjectPrompt} onChange={(e) => setNewProjectPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setShowNewProjectModal(false); }} />
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>⚡ AI will generate a project name, description, AI instructions, and a conversation branch for each major area.</div>
                                    </>
                                )}
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                                    <button type="button" disabled={newProjectLoading} onClick={() => setShowNewProjectModal(false)} style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Cancel</button>
                                    <button type="button" disabled={newProjectLoading || (newProjectMode === 'manual' ? !newProjectName.trim() : !newProjectPrompt.trim())} onClick={() => void submitNewProject()} style={{ padding: '7px 18px', fontSize: '13px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {newProjectLoading ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating...</> : newProjectMode === 'manual' ? 'Create' : '🌳 Generate Tree'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden">
            <ToastContainer />
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
                                                        {['📁', '🚀', '💡', '🎯', '🔧', '📊', '🤖', '🧪', '💻', '🎨', '📝', '⚡', '🔬', '🌐', '🏗️', '🎮', '📈', '🛡️', '🔑', '💎'].map(em => (
                                                            <button key={em} type="button"
                                                                style={{ fontSize: '20px', padding: '4px', background: editingProject?.emoji === em ? 'var(--accent-glow)' : 'none', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                                onClick={() => { setEditingProject(prev => prev ? { ...prev, emoji: em } : prev); setShowEmojiPicker(false); }}>
                                                                {em}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>Colour</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                        {['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16', '#6366f1'].map(c => (
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
                                                        {activeId === c.id && (
                                                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', flexShrink: 0, display: 'inline-block', boxShadow: '0 0 5px #4ade80' }} title="Active" />
                                                        )}
                                                        {proj && activeId !== c.id && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: proj.color, flexShrink: 0, display: 'inline-block' }} title={proj.name} />}
                                                        {generatingBranches.has(c.id) && (
                                                            <span style={{ display: 'inline-block', width: '10px', height: '10px', border: '2px solid rgba(249,115,22,0.3)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} title="Generating code..." />
                                                        )}
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

            {/* File Tree Panel */}
            {fileTreeOpen && (
                <>
                    <aside
                        style={{ width: fileTreeWidth, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}
                    >
                        {/* File Tree Header */}
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Explorer</span>
                            <button
                                type="button"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', padding: '1px 4px', borderRadius: '3px' }}
                                onClick={() => setFileTreeOpen(false)}
                                title="Close explorer"
                            >✕</button>
                        </div>

                        {/* Explorer Overlay — add file / link chat */}
                        {explorerOverlay && (
                            <div
                                style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => { setExplorerOverlay(null); setNewFileName(''); }}
                            >
                                <div
                                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '16px', width: '220px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                                    onClick={e => e.stopPropagation()}
                                >
                                    {explorerOverlay.type === 'add-file' && (
                                        <>
                                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>📄 New Code File</div>
                                            <input
                                                autoFocus
                                                placeholder="e.g. strategy.pine"
                                                value={newFileName}
                                                onChange={e => setNewFileName(e.target.value)}
                                                onKeyDown={async e => {
                                                    if (e.key === 'Enter' && newFileName.trim()) {
                                                        const pid = explorerOverlay.projectId;
                                                        await uploadProjectFile(pid, new File([''], newFileName.trim(), { type: 'text/plain' }));
                                                        if (!projectFiles[pid]) void loadProjectDetail(pid);
                                                        setExpandedProjects(prev => ({ ...prev, [pid]: true }));
                                                        setExplorerOverlay(null);
                                                        setNewFileName('');
                                                    }
                                                    if (e.key === 'Escape') { setExplorerOverlay(null); setNewFileName(''); }
                                                }}
                                                style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '7px 10px', color: 'var(--text-primary)', fontSize: '12px', marginBottom: '8px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}
                                            />
                                            {/* Top 5 existing snippets as quick-pick */}
                                            {savedCodes.length > 0 && (
                                                <div style={{ marginBottom: '8px' }}>
                                                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Or pick existing snippet</div>
                                                    {savedCodes.slice(0, 5).map(s => (
                                                        <button
                                                            key={s.id}
                                                            type="button"
                                                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '5px', cursor: 'pointer', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'DM Sans, sans-serif' }}
                                                            onClick={async () => {
                                                                const pid = explorerOverlay.projectId;
                                                                await uploadProjectFile(pid, new File([s.code], `${s.name}.pine`, { type: 'text/plain' }));
                                                                if (!projectFiles[pid]) void loadProjectDetail(pid);
                                                                setExpandedProjects(prev => ({ ...prev, [pid]: true }));
                                                                setExplorerOverlay(null);
                                                                setNewFileName('');
                                                            }}
                                                        >
                                                            🌲 {s.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                <button type="button" onClick={() => { setExplorerOverlay(null); setNewFileName(''); }}
                                                    style={{ padding: '5px 12px', fontSize: '11px', borderRadius: '5px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                                    Cancel
                                                </button>
                                                <button type="button"
                                                    disabled={!newFileName.trim()}
                                                    onClick={async () => {
                                                        if (!newFileName.trim()) return;
                                                        const pid = explorerOverlay.projectId;
                                                        await uploadProjectFile(pid, new File([''], newFileName.trim(), { type: 'text/plain' }));
                                                        if (!projectFiles[pid]) void loadProjectDetail(pid);
                                                        setExpandedProjects(prev => ({ ...prev, [pid]: true }));
                                                        setExplorerOverlay(null);
                                                        setNewFileName('');
                                                    }}
                                                    style={{ padding: '5px 12px', fontSize: '11px', borderRadius: '5px', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', opacity: newFileName.trim() ? 1 : 0.5 }}>
                                                    Create
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {explorerOverlay.type === 'link-chat' && (
                                        <>
                                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>💬 Link Chat Session</div>
                                            {(() => {
                                                const unlinked = conversations.filter(c => !convProjects[c.id]);
                                                if (unlinked.length === 0) return (
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>All chats are already linked to a project.</div>
                                                );
                                                return (
                                                    <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        {unlinked.slice(0, 5).map(c => {
                                                            const label = titles[c.id] ?? c.title ?? c.id.slice(0, 8);
                                                            return (
                                                                <button
                                                                    key={c.id}
                                                                    type="button"
                                                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: '12px', color: '#ffffff', background: '#2a2a2a', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'DM Sans, sans-serif', fontWeight: 500 }}
                                                                    onMouseEnter={e => (e.currentTarget.style.background = '#333')}
                                                                    onMouseLeave={e => (e.currentTarget.style.background = '#2a2a2a')}
                                                                    onClick={() => {
                                                                        assignToProject(c.id, explorerOverlay.projectId);
                                                                        setExpandedProjects(prev => ({ ...prev, [explorerOverlay.projectId]: true }));
                                                                        setExplorerOverlay(null);
                                                                    }}
                                                                >
                                                                    💬 {label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <button type="button" onClick={() => setExplorerOverlay(null)}
                                                    style={{ padding: '5px 12px', fontSize: '11px', borderRadius: '5px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* File Tree Body */}
                        <div className="flex-1 overflow-y-auto" style={{ padding: '6px 0' }}>
                            {projects.length === 0 ? (
                                <div style={{ padding: '12px 10px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                    <div style={{ marginBottom: '4px', opacity: 0.4 }}>📁</div>
                                    No projects
                                </div>
                            ) : (
                                projects.map(proj => {
                                    const isExpanded = expandedProjects[proj.id] ?? false;
                                    const files = projectFiles[proj.id] ?? [];
                                    const linkedConvIds = Object.entries(convProjects)
                                        .filter(([, pid]) => pid === proj.id)
                                        .map(([cid]) => cid);

                                    return (
                                        <div key={proj.id}>
                                            {/* Project row */}
                                            <div
                                                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', cursor: 'pointer', userSelect: 'none', fontSize: '12px', color: 'var(--text-secondary)', background: activeProjectFilter === proj.id ? 'var(--accent-glow)' : 'transparent' }}
                                                onClick={() => {
                                                    const expanding = !isExpanded;
                                                    setExpandedProjects(prev => ({ ...prev, [proj.id]: expanding }));
                                                    if (expanding) void loadProjectDetail(proj.id);
                                                }}
                                            >
                                                <span style={{ fontSize: '9px', color: 'var(--text-muted)', width: '10px', display: 'inline-block' }}>
                                                    {isExpanded ? '▼' : '▶'}
                                                </span>
                                                <span style={{ fontSize: '13px' }}>{proj.emoji ?? '📁'}</span>
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                                    {proj.name}
                                                </span>
                                                {/* Always-visible + Add button */}
                                                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        title="Add code file"
                                                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', padding: '1px 5px', lineHeight: 1.4 }}
                                                        onClick={() => { setNewFileName(''); setExplorerOverlay({ type: 'add-file', projectId: proj.id }); }}
                                                    >📄+</button>
                                                    <button
                                                        type="button"
                                                        title="Link a chat session"
                                                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', padding: '1px 5px', lineHeight: 1.4 }}
                                                        onClick={() => setExplorerOverlay({ type: 'link-chat', projectId: proj.id })}
                                                    >💬+</button>
                                                </div>
                                            </div>

                                            {/* Expanded content */}
                                            {isExpanded && (
                                                <div>
                                                    {/* ── Code Files sub-section ── */}
                                                    <div style={{ padding: '4px 10px 2px 22px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                        📄 Code Files
                                                    </div>
                                                    {files.length === 0 ? (
                                                        <div style={{ padding: '2px 10px 4px 24px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                            No files — click 📄+ to add
                                                        </div>
                                                    ) : (
                                                        files.map(file => {
                                                            const isActiveFile = activeFileId === file.id;
                                                            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                                                            const icon = ext === 'pine' || ext === 'pinescript' ? '🌲'
                                                                : ext === 'py' ? '🐍'
                                                                    : ext === 'cs' ? '🎮'
                                                                        : ext === 'ts' || ext === 'tsx' ? '📘'
                                                                            : ext === 'js' || ext === 'jsx' ? '📙'
                                                                                : ext === 'json' ? '📋'
                                                                                    : ext === 'md' ? '📝'
                                                                                        : '📄';
                                                            return (
                                                                <div
                                                                    key={file.id}
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 10px 3px 24px', cursor: 'pointer', fontSize: '11px', color: isActiveFile ? 'var(--accent)' : 'var(--text-muted)', background: isActiveFile ? 'var(--accent-glow)' : 'transparent', borderLeft: isActiveFile ? '2px solid var(--accent)' : '2px solid transparent' }}
                                                                    onClick={() => {
                                                                        setActiveFileId(file.id);
                                                                        setCodeText(file.content);
                                                                        setUnsavedCode(file.content);
                                                                        setHasUnsavedChanges(false);
                                                                        setActiveCodeId(null);
                                                                        setCodeOpen(true);
                                                                        addToHistory(file.content);
                                                                    }}
                                                                >
                                                                    <span>{icon}</span>
                                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {file.name}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '3px', cursor: 'pointer', fontSize: '9px', color: '#f87171', padding: '2px 5px', flexShrink: 0, fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}
                                                                        title="Remove file"
                                                                        onClick={async (e) => {
                                                                            e.stopPropagation();
                                                                            await removeProjectFile(proj.id, file.id);
                                                                            if (activeFileId === file.id) setActiveFileId(null);
                                                                        }}
                                                                    >remove</button>
                                                                </div>
                                                            );
                                                        })
                                                    )}

                                                    {/* ── Chat Sessions sub-section ── */}
                                                    <div style={{ padding: '6px 10px 2px 22px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                        💬 Chat Sessions
                                                    </div>
                                                    {linkedConvIds.length === 0 ? (
                                                        <div style={{ padding: '2px 10px 6px 24px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                            No chats — click 💬+ to link
                                                        </div>
                                                    ) : (
                                                        linkedConvIds.map(cid => {
                                                            const conv = conversations.find(c => c.id === cid);
                                                            const label = titles[cid] ?? conv?.title ?? cid.slice(0, 8);
                                                            const isActive = activeId === cid;
                                                            return (
                                                                <div
                                                                    key={cid}
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 10px 3px 24px', cursor: 'pointer', fontSize: '11px', color: isActive ? 'var(--accent)' : 'var(--text-muted)', background: isActive ? 'var(--accent-glow)' : 'transparent', borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent' }}
                                                                    onClick={() => {
                                                                        // Just highlight — don't open
                                                                        router.push(`/?c=${encodeURIComponent(cid)}`);
                                                                    }}
                                                                >
                                                                    <span>💬</span>
                                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {label}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '3px', cursor: 'pointer', fontSize: '9px', color: '#f87171', padding: '2px 5px', flexShrink: 0, fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}
                                                                        title="Unlink chat"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            assignToProject(cid, null);
                                                                        }}
                                                                    >unlink</button>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer — new project shortcut */}
                        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)' }}>
                            <button
                                type="button"
                                style={{ width: '100%', padding: '5px 0', fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '5px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                onClick={() => void createProject()}
                            >+ New project</button>
                        </div>
                    </aside>

                    {/* File tree drag handle */}
                    <div
                        className="w-1 cursor-col-resize"
                        style={{ background: 'var(--border-subtle)' }}
                        onPointerDown={() => { draggingRef.current = "filetree"; }}
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
                        onClick={() => setFileTreeOpen((v) => !v)}
                        title={fileTreeOpen ? "Hide file explorer" : "Show file explorer"}>
                        {fileTreeOpen ? "✕ Explorer" : "📁 Explorer"}
                    </button>

                    <button type="button" className="btn-secondary" style={{ padding: '5px 12px', fontSize: '12px' }}
                        onClick={() => setSettingsOpen(true)}>
                        ⚙ Settings
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                        {/* Plan badge */}
                        {userPlan === 'free' ? (
                            <button type="button"
                                onClick={() => setShowUpgradeModal(true)}
                                style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.08)', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontWeight: 600 }}>
                                Free → Upgrade Pro
                            </button>
                        ) : (
                            <button type="button"
                                onClick={() => void openBillingPortal()}
                                style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#4ade80', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                ✓ Pro · Manage
                            </button>
                        )}
                        <button type="button"
                            onClick={async () => {
                                if (confirm("Sign out?")) {
                                    await supabase.auth.signOut();
                                }
                            }}
                            style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                            Sign out
                        </button>
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
                                {(['prompts', 'plugins', 'appearance', 'billing', 'contact', 'howto'] as const).map((tab) => (
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
                                        {tab === 'prompts' ? 'Prompt Settings' :
                                            tab === 'plugins' ? 'Plugins' :
                                                tab === 'appearance' ? 'Appearance' :
                                                    tab === 'billing' ? 'Subscription' :
                                                        tab === 'contact' ? 'Contact' :
                                                            'How to Use'}
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

                                {activeSettingsTab === 'billing' && (
                                    <div className="space-y-4">
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Subscription</p>
                                        <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border-default)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>Current plan</span>
                                                {userPlan === 'pro' ? (
                                                    <span style={{ padding: '3px 10px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#4ade80', fontWeight: 600 }}>✓ Pro</span>
                                                ) : (
                                                    <span style={{ padding: '3px 10px', fontSize: '11px', borderRadius: '20px', border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.08)', color: 'var(--accent)', fontWeight: 600 }}>Free</span>
                                                )}
                                            </div>
                                            {userPlan === 'pro' ? (
                                                <button type="button"
                                                    onClick={() => { setSettingsOpen(false); void openBillingPortal(); }}
                                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-hover)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                                    Manage Subscription →
                                                </button>
                                            ) : (
                                                <button type="button"
                                                    onClick={() => { setSettingsOpen(false); setShowUpgradeModal(true); }}
                                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                                    🚀 Upgrade to Pro
                                                </button>
                                            )}
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Manage your subscription, update payment details, or cancel via the Stripe billing portal.
                                        </p>
                                    </div>
                                )}

                                {activeSettingsTab === 'contact' && (
                                    <div className="space-y-4">
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Get in touch</p>

                                        {/* Email */}
                                        <a href="mailto:t4nt3ch@gmail.com"
                                            style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', textDecoration: 'none', transition: 'border-color 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}>
                                            <span style={{ fontSize: '22px', width: '32px', textAlign: 'center' }}>✉️</span>
                                            <div>
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Email</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>t4nt3ch@gmail.com</div>
                                            </div>
                                            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>↗</span>
                                        </a>

                                        {/* Instagram */}
                                        <a href="https://www.instagram.com/t4nt3ch/" target="_blank" rel="noopener noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', textDecoration: 'none', transition: 'border-color 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = '#e1306c')}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}>
                                            <span style={{ fontSize: '22px', width: '32px', textAlign: 'center' }}>📸</span>
                                            <div>
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Instagram</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>@t4nt3ch</div>
                                            </div>
                                            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>↗</span>
                                        </a>

                                        {/* YouTube */}
                                        <a href="https://www.youtube.com/@TanTechTrades" target="_blank" rel="noopener noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', textDecoration: 'none', transition: 'border-color 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = '#ff0000')}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}>
                                            <span style={{ fontSize: '22px', width: '32px', textAlign: 'center' }}>▶️</span>
                                            <div>
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>YouTube</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>@TanTechTrades</div>
                                            </div>
                                            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>↗</span>
                                        </a>

                                        {/* Discord — Pro only */}
                                        {userPlan === 'pro' ? (
                                            <a href="https://discord.com/channels/1480956412434841671/1480987063590457425" target="_blank" rel="noopener noreferrer"
                                                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', textDecoration: 'none', transition: 'border-color 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.borderColor = '#5865f2')}
                                                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}>
                                                <span style={{ fontSize: '22px', width: '32px', textAlign: 'center' }}>💬</span>
                                                <div>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Discord <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: 'rgba(34,197,94,0.1)', color: '#4ade80', marginLeft: '6px' }}>Pro</span></div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>T4N Community Server</div>
                                                </div>
                                                <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>↗</span>
                                            </a>
                                        ) : (
                                            <div
                                                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', opacity: 0.6, cursor: 'pointer' }}
                                                onClick={() => { setSettingsOpen(false); setShowUpgradeModal(true); }}>
                                                <span style={{ fontSize: '22px', width: '32px', textAlign: 'center' }}>💬</span>
                                                <div>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Discord <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: 'rgba(249,115,22,0.1)', color: 'var(--accent)', marginLeft: '6px' }}>&#10022; Pro only</span></div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Upgrade to access the community</div>
                                                </div>
                                                <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--accent)' }}>Upgrade &#8594;</span>
                                            </div>
                                        )}

                                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', paddingTop: '4px' }}>
                                            Note: the Discord link requires you to already be a member of the server. If you can&apos;t access it, email us and we&apos;ll send you an invite.
                                        </p>
                                    </div>
                                )}

                                {activeSettingsTab === 'howto' && (
                                    <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                                        {/* Overview */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Overview</p>
                                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '16px' }}>
                                                T4N is an AI coding workspace built for generating, editing, debugging, and organizing code inside focused projects. It is designed for users working across areas such as Pine Script, Python, JavaScript, TypeScript, Unity, Blender, web development, automation, and other coding tasks.
                                            </p>
                                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                                                The platform combines chat, project context, snippets, and version history so work stays organized instead of getting lost in a single conversation.
                                            </p>
                                        </div>

                                        {/* What T4N Can Do */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>What T4N Can Do</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {[
                                                    { title: 'Project-based coding', desc: 'Create separate projects for different tasks, tools, or clients. Each project keeps its own chat context, code snippets, and workflow history.' },
                                                    { title: 'AI-assisted code generation', desc: 'Describe what you want to build and T4N can generate code, functions, scripts, logic updates, or full file drafts.' },
                                                    { title: 'Debugging and fixing code', desc: 'Paste broken code or error messages into chat and ask for a fix, explanation, or rewrite.' },
                                                    { title: 'Editing existing code', desc: 'Use T4N to improve structure, refactor code, add features, optimize logic, or convert styles and patterns.' },
                                                    { title: 'Snippet management', desc: 'Store code inside snippets so work is organized by file or feature instead of being mixed into chat messages.' },
                                                    { title: 'Version history', desc: 'Track changes to snippets and restore previous versions when needed.' },
                                                    { title: 'Multi-domain support', desc: 'Use T4N for different coding areas such as trading scripts, Python automation, frontend development, game scripting, and more.' },
                                                ].map(({ title, desc }) => (
                                                    <div key={title} style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--accent)', marginBottom: '4px' }}>{title}</div>
                                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>{desc}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Getting Started */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Getting Started</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                        <span style={{ background: 'var(--accent)', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>1</span>
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Create a project</span>
                                                    </div>
                                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '28px' }}>
                                                        Start by creating a new project for the thing you want to build. Examples: Trading strategy, Python automation script, React component, Unity system, Bug fixing session.
                                                    </p>
                                                </div>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                        <span style={{ background: 'var(--accent)', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>2</span>
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Choose the correct topic or language</span>
                                                    </div>
                                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '28px' }}>
                                                        Before prompting, decide what stack or language you are working in: Pine Script, Python, JavaScript, TypeScript, C#, Blender Python, cTrader / trading logic.
                                                    </p>
                                                </div>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                        <span style={{ background: 'var(--accent)', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>3</span>
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Create or open a snippet</span>
                                                    </div>
                                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '28px' }}>
                                                        A snippet acts like a working file. Use snippets to store generated code, edits, and iterations. Examples: strategy.pine, main.py, auth.ts, indicator.cs.
                                                    </p>
                                                </div>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                        <span style={{ background: 'var(--accent)', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>4</span>
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Start chatting with the AI</span>
                                                    </div>
                                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '28px' }}>
                                                        Ask clearly for what you want. Better prompts include: the language, the goal, any errors, any rules to follow, whether you want full code or just a change.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Best Ways to Use Chat */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Best Ways to Use Chat</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                {[
                                                    { type: 'Ask for new code', example: 'Build a Python script that reads a CSV and calculates monthly totals.' },
                                                    { type: 'Ask for edits', example: 'Add error handling but keep everything else the same.' },
                                                    { type: 'Ask for debugging', example: 'This script fails on line 42. Explain the issue and rewrite only the broken section.' },
                                                    { type: 'Ask for refactors', example: 'Refactor this into smaller reusable functions.' },
                                                    { type: 'Ask for explanation', example: 'Explain what this code is doing and why.' },
                                                ].map(({ type, example }) => (
                                                    <div key={type} style={{ background: 'var(--bg-elevated)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--accent)', marginBottom: '4px' }}>{type}</div>
                                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{example}"</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Tips for Better Results */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Tips for Better Results</p>
                                            <div style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.8' }}>
                                                    <li><span style={{ color: 'var(--accent)' }}>Be specific</span> — Clear prompts produce better code than broad ones</li>
                                                    <li><span style={{ color: 'var(--accent)' }}>Include constraints</span> — Mention anything the AI must preserve</li>
                                                    <li><span style={{ color: 'var(--accent)' }}>Include the full error</span> — Paste actual error text, don't paraphrase</li>
                                                    <li><span style={{ color: 'var(--accent)' }}>Mention output format</span> — Full file, updated function, explanation plus code</li>
                                                </ul>
                                            </div>
                                        </div>

                                        {/* Working With Snippets */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Working With Snippets</p>
                                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '12px' }}>
                                                Snippets are where your code is stored and edited. Use snippets when you want to keep code saved inside a project, maintain separate files, compare versions, or continue improving code over time.
                                            </p>
                                            <div style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 4px 0', fontWeight: 500 }}>Recommended approach:</p>
                                                <ol style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.8' }}>
                                                    <li>Create a project</li>
                                                    <li>Create a snippet</li>
                                                    <li>Generate code in chat</li>
                                                    <li>Move good output into the snippet</li>
                                                    <li>Continue iterating</li>
                                                </ol>
                                            </div>
                                        </div>

                                        {/* Version History */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Version History</p>
                                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                                                T4N keeps version history for snippets so changes can be reviewed and restored. Use version history when a recent change made the file worse, you want to compare an older working version, or you want to restore a previous draft.
                                            </p>
                                        </div>

                                        {/* What T4N Is Best At */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>What T4N Is Best At</p>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {['Generating first drafts', 'Fixing errors', 'Rewriting messy code', 'Converting logic into code', 'Iterating on existing files', 'Organizing work'].map(item => (
                                                    <span key={item} style={{ background: 'rgba(249,115,22,0.1)', color: 'var(--accent)', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', border: '1px solid rgba(249,115,22,0.2)' }}>{item}</span>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Limitations */}
                                        <div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Limitations to Keep in Mind</p>
                                            <div style={{ background: 'rgba(239,68,68,0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
                                                <p style={{ fontSize: '12px', color: '#f87171', margin: '0 0 8px 0', fontWeight: 500 }}>⚠ AI-generated code should still be reviewed and tested before production use.</p>
                                                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
                                                    <li>Check logic carefully</li>
                                                    <li>Test strategy behaviour</li>
                                                    <li>Verify syntax</li>
                                                    <li>Review security-sensitive code</li>
                                                    <li>Confirm imports and dependencies</li>
                                                </ul>
                                            </div>
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
                            <div className="flex items-center justify-center h-full">
                                <div style={{ textAlign: 'center', maxWidth: 340, padding: '0 24px' }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
                                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 }}>Welcome to T4N</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>AI coding assistant for traders. Ask anything or try a suggestion.</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {['🔍 Explain what this indicator does', '🔧 Fix the errors in my Pine Script', '🔄 Convert this strategy to Python', '🧪 Add alerts to my strategy'].map(s => (
                                            <button key={s} type="button"
                                                onClick={() => { if (giveAiAccessToCode && codeText.trim()) { setInput(s); setTimeout(() => { void handleSend(); }, 0); } else { const el = document.querySelector('textarea[placeholder="Message T4N…"]') as HTMLTextAreaElement; if (el) { el.value = s; el.focus(); el.dispatchEvent(new Event('input', { bubbles: true })); } } }}
                                                style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'DM Sans, sans-serif', transition: 'border-color 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                                            >{s}</button>
                                        ))}
                                    </div>
                                </div>
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

                                                    const blockId = segKey++;
                                                    segments.push(
                                                        <div key={blockId} style={{ margin: '10px 0' }}>
                                                            {/* FIND box */}
                                                            <div style={{ borderRadius: '6px 6px 0 0', overflow: 'hidden', border: '1px solid rgba(249,115,22,0.35)', borderBottom: 'none' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: 'rgba(249,115,22,0.1)' }}>
                                                                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>FIND</span>
                                                                    <button type="button"
                                                                        style={{
                                                                            fontSize: '10px',
                                                                            padding: '2px 8px',
                                                                            borderRadius: '4px',
                                                                            border: copiedBlockId === `find-${blockId}` ? '1px solid #f97316' : '1px solid rgba(249,115,22,0.3)',
                                                                            background: copiedBlockId === `find-${blockId}` ? '#f97316' : 'transparent',
                                                                            color: copiedBlockId === `find-${blockId}` ? '#fff' : 'var(--accent)',
                                                                            fontWeight: copiedBlockId === `find-${blockId}` ? 'bold' : 'normal',
                                                                            cursor: 'pointer',
                                                                            transition: 'all 0.2s',
                                                                            boxShadow: copiedBlockId === `find-${blockId}` ? '0 0 10px rgba(249,115,22,0.5)' : 'none'
                                                                        }}
                                                                        onClick={async () => {
                                                                            try {
                                                                                await navigator.clipboard.writeText(findText);
                                                                                setCopiedBlockId(`find-${blockId}`);
                                                                                setTimeout(() => setCopiedBlockId(null), 1500);
                                                                                highlightInCanvas(findText);
                                                                            } catch { }
                                                                        }}>
                                                                        {copiedBlockId === `find-${blockId}` ? '✓ Copied!' : 'Copy'}
                                                                    </button>
                                                                </div>
                                                                <pre style={{ margin: 0, padding: '8px 10px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#e2e2e8', background: '#0d0d10', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{findText}</pre>
                                                            </div>
                                                            {/* REPLACE/ADD box */}
                                                            <div style={{ borderRadius: '0 0 6px 6px', overflow: 'hidden', border: '1px solid rgba(99,102,241,0.35)' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: 'rgba(99,102,241,0.1)' }}>
                                                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{actionLabel}</span>
                                                                    <button type="button"
                                                                        style={{
                                                                            fontSize: '10px',
                                                                            padding: '2px 8px',
                                                                            borderRadius: '4px',
                                                                            border: copiedBlockId === `replace-${blockId}` ? '1px solid #818cf8' : '1px solid rgba(99,102,241,0.3)',
                                                                            background: copiedBlockId === `replace-${blockId}` ? '#818cf8' : 'transparent',
                                                                            color: copiedBlockId === `replace-${blockId}` ? '#fff' : '#818cf8',
                                                                            fontWeight: copiedBlockId === `replace-${blockId}` ? 'bold' : 'normal',
                                                                            cursor: 'pointer',
                                                                            transition: 'all 0.2s',
                                                                            boxShadow: copiedBlockId === `replace-${blockId}` ? '0 0 10px rgba(99,102,241,0.5)' : 'none'
                                                                        }}
                                                                        onClick={async () => {
                                                                            try {
                                                                                await navigator.clipboard.writeText(replaceText);
                                                                                setCopiedBlockId(`replace-${blockId}`);
                                                                                setTimeout(() => setCopiedBlockId(null), 1500);
                                                                            } catch { }
                                                                        }}>
                                                                        {copiedBlockId === `replace-${blockId}` ? '✓ Copied!' : 'Copy'}
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

                                    {/* Apply to Editor button — show on completed assistant messages that contain code */}
                                    {!isUser && !isActiveStreaming && (() => {
                                        const extracted = extractCodeBlocks(m.content ?? '');
                                        if (!extracted) return null;
                                        const blockId = m.id;
                                        const applied = appliedBlockId === blockId;
                                        return (
                                            <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                <button
                                                    type="button"
                                                    style={{
                                                        padding: '4px 12px',
                                                        fontSize: '11px',
                                                        borderRadius: '6px',
                                                        border: applied ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(249,115,22,0.4)',
                                                        background: applied ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.08)',
                                                        color: applied ? '#4ade80' : 'var(--accent)',
                                                        cursor: 'pointer',
                                                        fontFamily: 'DM Sans, sans-serif',
                                                        fontWeight: 600,
                                                        transition: 'all 0.2s',
                                                    }}
                                                    onClick={() => {
                                                        const code = extractCodeBlocks(m.content ?? '');
                                                        if (!code) return;
                                                        setCodeText(code);
                                                        addToHistory(code);
                                                        setHasUnsavedChanges(true);
                                                        if (!activeCodeId) {
                                                            setUnsavedCode(code);
                                                            setActiveCodeId(null);
                                                        }
                                                        setCodeOpen(true);
                                                        setAppliedBlockId(blockId);
                                                        setTimeout(() => setAppliedBlockId(null), 1500);
                                                    }}
                                                >
                                                    {applied ? '✓ Applied' : '⬇ Apply to Editor'}
                                                </button>
                                                {applied && (
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                        Hit Undo to revert
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })()}

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
                                                // Prompt for name then save as new snippet
                                                promptSaveCurrentCode();
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
                                                showToast('Code copied!');
                                            } catch {
                                                showToast('Copy failed', 'error');
                                            }
                                        }}
                                        disabled={!codeText.trim()}
                                        title="Copy code to clipboard"
                                    >
                                        Copy
                                    </button>

                                    {/* Domain / Language Selector */}
                                    {/* Export dropdown */}
                                    {codeText.trim() && (
                                        <div style={{ position: 'relative' }}>
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                                onClick={(e) => { const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setExportDropdownPos({ top: r.bottom + 4, left: r.right - 200 }); setExportDropdownOpen(v => !v); }}
                                                title="Export code"
                                            >
                                                ⬇ Export
                                            </button>
                                            {exportDropdownOpen && (
                                                <div
                                                    style={{ position: 'fixed', top: exportDropdownPos.top, left: exportDropdownPos.left, zIndex: 9999, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: '200px', overflow: 'auto', maxHeight: '60vh' }}
                                                    onMouseLeave={() => setExportDropdownOpen(false)}
                                                >
                                                    {[
                                                        {
                                                            label: '📄 Download as file',
                                                            sublabel: (() => {
                                                                const ext = selectedDomain === 'python' ? '.py' : selectedDomain === 'react' ? '.tsx' : selectedDomain === 'typescript' ? '.ts' : selectedDomain === 'javascript' ? '.js' : selectedDomain === 'mql5' ? '.mq5' : selectedDomain === 'ctrader' ? '.cs' : selectedDomain === 'unity' ? '.cs' : selectedDomain === 'blender' ? '.py' : '.pine';
                                                                return ext;
                                                            })(),
                                                            action: () => {
                                                                const ext = selectedDomain === 'python' ? '.py' : selectedDomain === 'react' ? '.tsx' : selectedDomain === 'typescript' ? '.ts' : selectedDomain === 'javascript' ? '.js' : selectedDomain === 'mql5' ? '.mq5' : selectedDomain === 'ctrader' ? '.cs' : selectedDomain === 'unity' ? '.cs' : selectedDomain === 'blender' ? '.py' : '.pine';
                                                                const name = savedCodes.find(s => s.id === activeCodeId)?.name ?? 'snippet';
                                                                const safe = name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
                                                                const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                a.href = url; a.download = `${safe}${ext}`;
                                                                document.body.appendChild(a); a.click(); a.remove();
                                                                URL.revokeObjectURL(url);
                                                                setExportDropdownOpen(false);
                                                            }
                                                        },
                                                        {
                                                            label: '📋 Copy as Markdown',
                                                            sublabel: 'Fenced code block',
                                                            action: async () => {
                                                                const lang = selectedDomain === 'python' ? 'python' : selectedDomain === 'react' ? 'tsx' : selectedDomain === 'typescript' ? 'typescript' : selectedDomain === 'javascript' ? 'javascript' : selectedDomain === 'ctrader' ? 'csharp' : selectedDomain === 'mql5' ? 'cpp' : 'pine';
                                                                const md = `\`\`\`${lang}\n${codeText}\n\`\`\``;
                                                                await navigator.clipboard.writeText(md);
                                                                setExportDropdownOpen(false);
                                                            }
                                                        },
                                                        {
                                                            label: '🗜 Export project as zip',
                                                            sublabel: 'All project files',
                                                            action: async () => {
                                                                const activeConvProjectId = activeId ? convProjects[activeId] : null;
                                                                const proj = projects.find(p => p.id === activeConvProjectId);
                                                                const files = proj ? (projectFiles[proj.id] ?? []) : [];
                                                                if (!proj || files.length === 0) {
                                                                    alert('No project files to export. Assign this chat to a project with files first.');
                                                                    setExportDropdownOpen(false);
                                                                    return;
                                                                }
                                                                const JSZip = (await import('jszip')).default;
                                                                const zip = new JSZip();
                                                                for (const f of files) zip.file(f.name, f.content);
                                                                const blob = await zip.generateAsync({ type: 'blob' });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                const safeName = proj.name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
                                                                a.href = url; a.download = `${safeName}.zip`;
                                                                document.body.appendChild(a); a.click(); a.remove();
                                                                URL.revokeObjectURL(url);
                                                                setExportDropdownOpen(false);
                                                            }
                                                        },
                                                    ].map(({ label, sublabel, action }) => (
                                                        <button
                                                            key={label}
                                                            type="button"
                                                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.1s' }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                            onClick={() => void action()}
                                                        >
                                                            <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
                                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{sublabel}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Monaco toggle */}
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{ padding: '4px 10px', fontSize: '12px', ...(useMonaco ? { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#818cf8' } : {}) }}
                                        onClick={() => setUseMonaco(v => !v)}
                                        title="Toggle Monaco editor"
                                    >
                                        {useMonaco ? '⚡ Monaco' : '📝 Basic'}
                                    </button>

                                    {useMonaco && (
                                        <>
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px', ...(monacoMinimap ? { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#818cf8' } : {}) }}
                                                onClick={() => setMonacoMinimap(v => !v)}
                                                title="Toggle minimap"
                                            >
                                                🗺 Map
                                            </button>
                                            <select
                                                value={monacoTheme}
                                                onChange={e => setMonacoTheme(e.target.value as typeof monacoTheme)}
                                                style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                            >
                                                <option value="vs-dark">🌑 Dark</option>
                                                <option value="light">☀️ Light</option>
                                                <option value="hc-black">⬛ High Contrast</option>
                                            </select>
                                        </>
                                    )}

                                    <select
                                        value={selectedDomain === 'auto' && codeText.length > 80 ? detectLanguage(codeText) : selectedDomain}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === 'auto') {
                                                setSelectedDomain(detectLanguage(codeText));
                                            } else {
                                                setSelectedDomain(val);
                                            }
                                        }}
                                        style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                        title="Select language / domain"
                                    >
                                        <option value="auto">🔍 {codeText.length > 80 ? (() => { const d = detectLanguage(codeText); return d === 'unity' ? 'Unity C#' : d === 'pinescript' ? 'Pine Script' : d === 'python' ? 'Python' : d === 'mql5' ? 'MQL5' : d === 'ctrader' ? 'cTrader' : d === 'react' ? 'React' : d === 'blender' ? 'Blender' : d === 'generic' ? 'Generic' : 'Auto-detect'; })() : 'Auto-detect'}</option>
                                        <option value="pinescript">🌲 Pine Script</option>
                                        <option value="ctrader">📊 cTrader</option>
                                        <option value="python">🐍 Python</option>
                                        <option value="mql5">⚙️ MT5 / MQL5</option>
                                        <option value="react">⚛️ React / Next.js</option>
                                        <option value="blender">🎨 Blender</option>
                                        <option value="unity">🎮 Unity</option>
                                        <option value="generic">💻 Generic Code</option>
                                    </select>

                                    {/* Open Tabs bar */}
                                    {useMonaco && openTabs.length > 0 && (
                                        <div style={{ display: 'flex', gap: '2px', flexWrap: 'nowrap', overflowX: 'auto', padding: '0 2px', maxWidth: '100%' }}>
                                            {openTabs.map(tid => {
                                                const tabSnippet = savedCodes.find(s => s.id === tid);
                                                if (!tabSnippet) return null;
                                                const isActive = activeTab === tid;
                                                return (
                                                    <div key={tid} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px 3px 10px', borderRadius: '5px 5px 0 0', background: isActive ? 'var(--bg-primary)' : 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderBottom: isActive ? '1px solid var(--bg-primary)' : '1px solid var(--border-default)', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '11px', color: isActive ? 'var(--accent)' : 'var(--text-muted)', fontWeight: isActive ? 600 : 400 }}
                                                        onClick={() => {
                                                            setActiveTab(tid);
                                                            setActiveCodeId(tid);
                                                            setCodeText(tabSnippet.code);
                                                        }}>
                                                        <span>{tabSnippet.name}</span>
                                                        <button type="button"
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', padding: '0 0 0 4px', lineHeight: 1 }}
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setOpenTabs(prev => prev.filter(t => t !== tid));
                                                                if (activeTab === tid) {
                                                                    const remaining = openTabs.filter(t => t !== tid);
                                                                    const next = remaining[remaining.length - 1] ?? null;
                                                                    setActiveTab(next);
                                                                    if (next) {
                                                                        const nextSnippet = savedCodes.find(s => s.id === next);
                                                                        if (nextSnippet) { setActiveCodeId(next); setCodeText(nextSnippet.code); }
                                                                    }
                                                                }
                                                            }}>✕</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

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
                                                    addToHistory(found.code);
                                                    runDiagnostics(found.code);
                                                    await loadVersions(id);
                                                    // Open in tabs if Monaco is on
                                                    if (useMonaco) {
                                                        setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id]);
                                                        setActiveTab(id);
                                                    }
                                                }
                                            }}
                                        >
                                            <option value="">{activeCodeId ? (savedCodes.find(s => s.id === activeCodeId)?.name ?? 'Saved snippets…') : activeFileId ? (Object.values(projectFiles).flat().find(f => f.id === activeFileId)?.name ?? 'Saved snippets…') : 'Saved snippets…'}</option>
                                            {hasUnsavedChanges && (
                                                <option value={UNSAVED_ID}>📝 Unsaved (new)</option>
                                            )}
                                            {savedCodes.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
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

                            {/* ── Toolbar: Actions + Pro Tools dropdowns ── */}
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', flexWrap: 'wrap' }}>

                                {/* ── Actions dropdown ── */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        disabled={!codeText.trim() || inlineActionBusy}
                                        style={{
                                            padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
                                            border: '1px solid var(--border-default)',
                                            background: actionsDropdownOpen ? 'var(--accent-glow)' : 'var(--bg-elevated)',
                                            color: actionsDropdownOpen ? 'var(--accent)' : 'var(--text-secondary)',
                                            cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer',
                                            opacity: !codeText.trim() || inlineActionBusy ? 0.5 : 1,
                                            fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px',
                                        }}
                                        onClick={(e) => { const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setActionsDropdownPos({ top: r.bottom + 4, left: r.left }); setActionsDropdownOpen(v => !v); setProToolsDropdownOpen(false); }}
                                    >
                                        {inlineActionBusy && ['🔍 Explain','🔧 Fix Errors','✨ Improve','📋 Add Comments','⚡ Optimise'].includes(inlineActionLabel ?? '') ? '⏳' : '⚡'} Actions ▾
                                    </button>
                                    {actionsDropdownOpen && (
                                        <div
                                            style={{ position: 'fixed', top: actionsDropdownPos.top, left: actionsDropdownPos.left, zIndex: 9999, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: '190px', overflow: 'auto', maxHeight: '60vh' }}
                                            onMouseLeave={() => setActionsDropdownOpen(false)}
                                        >
                                            {([
                                                { label: '🔍 Explain', prompt: 'Explain what this code does in plain English. Be concise.' },
                                                { label: '🔧 Fix Errors', prompt: 'Find and fix any errors, bugs, or issues in this code. Use Ctrl+F format for changes.' },
                                                { label: '✨ Improve', prompt: 'Suggest and apply improvements to this code for readability, performance, and best practices. Use Ctrl+F format.' },
                                                { label: '📋 Add Comments', prompt: 'Add clear inline comments to this code explaining what each section does. Use Ctrl+F format.' },
                                                { label: '⚡ Optimise', prompt: 'Optimise this code for speed and efficiency. Use Ctrl+F format for changes.' },
                                            ] as const).map(({ label, prompt }) => (
                                                <button
                                                    key={label}
                                                    type="button"
                                                    disabled={!codeText.trim() || inlineActionBusy}
                                                    style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                    onClick={async () => {
                                                        if (!codeText.trim() || inlineActionBusy) return;
                                                        setActionsDropdownOpen(false);
                                                        setInlineActionBusy(true);
                                                        setInlineActionLabel(label);
                                                        const domain = selectedDomain;
                                                        const projectContext = buildProjectContext();
                                                        const fullPrompt = `USER REQUEST:\n${prompt}\n\nEXISTING CODE (${domain}) — output the FULL corrected file, no truncation:\n\`\`\`\n${codeText.slice(0, 120000)}\n\`\`\`${projectContext}`;
                                                        try {
                                                            let cid = activeId;
                                                            if (!cid) { const newId = await startNewChat(); if (!newId) throw new Error('Failed to create conversation'); cid = newId; }
                                                            setMessages(m => [...m, { id: globalThis.crypto.randomUUID(), role: 'user', content: `${label} — running on current code…` }]);
                                                            const assistantId = globalThis.crypto.randomUUID();
                                                            activeAssistantIdRef.current = assistantId;
                                                            setMessages(m => [...m, { id: assistantId, role: 'assistant', content: '' }]);
                                                            abortRef.current?.abort();
                                                            const controller = new AbortController();
                                                            abortRef.current = controller;
                                                            setStreaming(true); setLoading(true);
                                                            const res = await streamMessage(fullPrompt, cid, controller.signal);
                                                            let streamed = '';
                                                            await readSseStream(res,
                                                                (delta) => {
                                                                    streamed += delta;
                                                                    const extracted = extractCodeBlocks(streamed);
                                                                    if (extracted && !/ctrl\+f:/i.test(streamed)) {
                                                                        const merged = (giveAiAccessToCode && accessLockedCode.trim()) ? mergePatchWithExisting(accessLockedCode, extracted) : extracted;
                                                                        setCodeText(merged); addToHistory(merged); setHasUnsavedChanges(true);
                                                                        if (!activeCodeId) setUnsavedCode(merged);
                                                                        if (giveAiAccessToCode) setAccessLockedCode(merged);
                                                                        setCodeOpen(true);
                                                                    }
                                                                    const isCtrlF = /ctrl\+f:/i.test(streamed);
                                                                    setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: isCtrlF ? streamed.replace(/```[\w+-]*\n[\s\S]*?```\n?/g, '').replace(/\n{3,}/g, '\n\n').trim() : extractCodeBlocks(streamed) ? '[Code updated → check Code panel]' : stripCodeBlocks(streamed) } : msg));
                                                                },
                                                                (doneData) => { const finalCid = doneData?.conversationId || cid; if (finalCid) void refreshPluginRuns(finalCid); },
                                                                undefined, undefined, controller.signal,
                                                            );
                                                        } catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
                                                        finally { setInlineActionBusy(false); setInlineActionLabel(null); setStreaming(false); setLoading(false); activeAssistantIdRef.current = null; abortRef.current = null; }
                                                    }}
                                                >
                                                    <span style={{ fontSize: '12px', color: inlineActionLabel === label ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 500 }}>{inlineActionLabel === label ? '⏳' : label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* ── Pro Tools dropdown ── */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        disabled={!codeText.trim() || inlineActionBusy}
                                        style={{
                                            padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
                                            border: '1px solid rgba(249,115,22,0.45)',
                                            background: proToolsDropdownOpen ? 'var(--accent-glow)' : 'rgba(249,115,22,0.06)',
                                            color: 'var(--accent)',
                                            cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer',
                                            opacity: !codeText.trim() || inlineActionBusy ? 0.5 : 1,
                                            fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px',
                                        }}
                                        onClick={(e) => { const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setProToolsDropdownPos({ top: r.bottom + 4, left: r.left }); setProToolsDropdownOpen(v => !v); setActionsDropdownOpen(false); }}
                                    >
                                        ✦ Pro Tools ▾
                                        {userPlan !== 'pro' && <span style={{ fontSize: '8px', padding: '1px 4px', borderRadius: '3px', background: 'rgba(249,115,22,0.2)', color: 'var(--accent)', fontWeight: 700 }}>PRO</span>}
                                    </button>
                                    {proToolsDropdownOpen && (
                                        <div
                                            style={{ position: 'fixed', top: proToolsDropdownPos.top, left: proToolsDropdownPos.left, zIndex: 9999, background: 'var(--bg-elevated)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: '210px', overflow: 'auto', maxHeight: '60vh' }}
                                            onMouseLeave={() => setProToolsDropdownOpen(false)}
                                        >
                                            {([
                                                { label: '🔬 AI Code Review', prompt: `Perform a comprehensive code review. Return your analysis in this exact format:\n\n## 🔒 Security Issues\nList any security vulnerabilities, injection risks, or unsafe patterns. If none, say "None found."\n\n## ⚡ Performance Problems\nList any performance issues, unnecessary loops, memory leaks. If none, say "None found."\n\n## ❌ Bad Patterns\nList anti-patterns, code smells, poor naming. If none, say "None found."\n\n## ✅ Better Approaches\nSuggest concrete improvements with Ctrl+F format where applicable.\n\nBe specific with line references.` },
                                                { label: '🐛 Debug Mode', prompt: `Debug this code thoroughly. Return your analysis in this exact format:\n\n## 🔴 Error Identified\nDescribe the most likely bug or error\n\n## 🔍 Possible Causes\n1. First possible root cause\n2. Second possible root cause\n3. Third possible root cause\n\n## 🛠 Suggested Fix\nProvide the exact fix using Ctrl+F find-and-replace format.` },
                                                { label: '🧪 Generate Tests', prompt: `Generate comprehensive unit tests for this code. Include happy path, edge cases, and error handling. Use the correct framework (Jest/Vitest for TS/JS, pytest for Python, NUnit for C#). Output the full test file, ready to run.` },
                                                { label: '🏗️ Project Analysis', prompt: `Analyse this entire codebase/file and return:\n\n## 📐 Architecture Overview\nDescribe structure and patterns.\n\n## 🚨 Issues Found\n- Duplicated functions\n- Circular dependencies\n- Missing error handling\n- Performance bottlenecks\n\n## 🔧 Suggested Improvements\nPrioritised list with Ctrl+F format fixes.\n\n## 📊 Code Quality Score\nScore out of 10 with justification.` },
                                                { label: '🔀 Multi-File Refactor', prompt: `Refactor this code to clean architecture:\n- Extract repeated logic into reusable functions\n- Separate concerns (auth, data, UI)\n- Convert callbacks to async/await\n- Add TypeScript types where missing\n- Remove dead code\n\nOutput the FULL refactored file — no truncation.` },
                                                { label: '🚀 DevOps Assist', prompt: `Generate DevOps config for this project:\n\n## 🐳 Docker Setup\nDockerfile and docker-compose.yml\n\n## ⚙️ CI/CD Pipeline\nGitHub Actions YAML\n\n## 🚢 Deployment Commands\nStep-by-step shell commands\n\n## 🔑 Environment Variables\nRequired env vars with descriptions` },
                                                { label: '💬 Ask Project', prompt: `You are a codebase assistant. Analyse the provided code and answer questions about it — where features are, how things connect, what functions do. Be specific with line numbers and function names.\n\nCurrent code to analyse:` },
                                            ] as const).map(({ label, prompt }) => (
                                                <button
                                                    key={label}
                                                    type="button"
                                                    disabled={!codeText.trim() || inlineActionBusy}
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                    onClick={async () => {
                                                        if (!codeText.trim() || inlineActionBusy) return;
                                                        setProToolsDropdownOpen(false);
                                                        if (userPlan !== 'pro') { setShowUpgradeModal(true); return; }
                                                        const finalPrompt = label === '💬 Ask Project'
                                                            ? `${prompt}\n\n\`\`\`\n${codeText.slice(0, 120000)}\n\`\`\``
                                                            : `USER REQUEST:\n${prompt}\n\nSOURCE CODE (${selectedDomain}):\n\`\`\`\n${codeText.slice(0, 120000)}\n\`\`\`${buildProjectContext()}`;
                                                        setInlineActionBusy(true);
                                                        setInlineActionLabel(label);
                                                        try {
                                                            let cid = activeId;
                                                            if (!cid) { const newId = await startNewChat(); if (!newId) throw new Error('Failed to create conversation'); cid = newId; }
                                                            setMessages(m => [...m, { id: globalThis.crypto.randomUUID(), role: 'user', content: `${label} — running on current code…` }]);
                                                            const assistantId = globalThis.crypto.randomUUID();
                                                            activeAssistantIdRef.current = assistantId;
                                                            setMessages(m => [...m, { id: assistantId, role: 'assistant', content: '' }]);
                                                            abortRef.current?.abort();
                                                            const controller = new AbortController();
                                                            abortRef.current = controller;
                                                            setStreaming(true); setLoading(true);
                                                            const res = await streamMessage(finalPrompt, cid, controller.signal);
                                                            let streamed = '';
                                                            await readSseStream(res,
                                                                (delta) => {
                                                                    streamed += delta;
                                                                    const extracted = extractCodeBlocks(streamed);
                                                                    if (extracted && !/ctrl\+f:/i.test(streamed)) {
                                                                        const merged = (giveAiAccessToCode && accessLockedCode.trim()) ? mergePatchWithExisting(accessLockedCode, extracted) : extracted;
                                                                        setCodeText(merged); addToHistory(merged); setHasUnsavedChanges(true);
                                                                        if (!activeCodeId) setUnsavedCode(merged);
                                                                        if (giveAiAccessToCode) setAccessLockedCode(merged);
                                                                        setCodeOpen(true);
                                                                    }
                                                                    const isCtrlF = /ctrl\+f:/i.test(streamed);
                                                                    setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: isCtrlF ? streamed.replace(/```[\w+-]*\n[\s\S]*?```\n?/g, '').replace(/\n{3,}/g, '\n\n').trim() : extractCodeBlocks(streamed) ? `[${label} → check Code panel]` : stripCodeBlocks(streamed) } : msg));
                                                                },
                                                                (doneData) => { const finalCid = doneData?.conversationId || cid; if (finalCid) void refreshPluginRuns(finalCid); },
                                                                undefined, undefined, controller.signal,
                                                            );
                                                        } catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
                                                        finally { setInlineActionBusy(false); setInlineActionLabel(null); setStreaming(false); setLoading(false); activeAssistantIdRef.current = null; abortRef.current = null; }
                                                    }}
                                                >
                                                    <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 500 }}>{inlineActionLabel === label ? '⏳' : label}</span>
                                                    {userPlan !== 'pro' && <span style={{ fontSize: '8px', padding: '1px 4px', borderRadius: '3px', background: 'rgba(249,115,22,0.2)', color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>PRO</span>}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* ── ⭐ Preset star button ── */}
                                <button
                                    type="button"
                                    style={{
                                        padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
                                        border: '1px solid var(--border-default)',
                                        background: promptPresets.length > 0 ? 'rgba(249,115,22,0.1)' : 'var(--bg-elevated)',
                                        color: promptPresets.length > 0 ? 'var(--accent)' : 'var(--text-secondary)',
                                        cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                                    }}
                                    onClick={() => { setPresetModalMode('manage'); setShowPresetModal(true); }}
                                    title="Manage prompt presets"
                                >
                                    ⭐ {promptPresets.length > 0 ? promptPresets.length : ''}
                                </button>

                                {/* ── Preset quick-launch buttons ── */}
                                {promptPresets.slice(0, 3).map(preset => (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        disabled={!codeText.trim() || inlineActionBusy}
                                        title={preset.prompt}
                                        style={{
                                            padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
                                            border: '1px solid rgba(249,115,22,0.3)',
                                            background: inlineActionLabel === `preset-${preset.id}` ? 'var(--accent-glow)' : 'rgba(249,115,22,0.06)',
                                            color: inlineActionLabel === `preset-${preset.id}` ? 'var(--accent)' : 'var(--text-secondary)',
                                            cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer',
                                            opacity: !codeText.trim() || inlineActionBusy ? 0.5 : 1,
                                            fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis',
                                        }}
                                        onClick={async () => {
                                            if (!codeText.trim() || inlineActionBusy) return;
                                            setInlineActionBusy(true);
                                            setInlineActionLabel(`preset-${preset.id}`);
                                            const projectContext = buildProjectContext();
                                            const fullPrompt = `USER REQUEST:\n${preset.prompt}\n\nSOURCE CODE:\n\`\`\`\n${codeText.slice(0, 120000)}\n\`\`\`${projectContext}`;
                                            try {
                                                let cid = activeId;
                                                if (!cid) { const newId = await startNewChat(); if (!newId) throw new Error('Failed to create conversation'); cid = newId; }
                                                setMessages(m => [...m, { id: globalThis.crypto.randomUUID(), role: 'user', content: `📋 ${preset.name}` }]);
                                                const assistantId = globalThis.crypto.randomUUID();
                                                activeAssistantIdRef.current = assistantId;
                                                setMessages(m => [...m, { id: assistantId, role: 'assistant', content: '' }]);
                                                abortRef.current?.abort();
                                                const controller = new AbortController();
                                                abortRef.current = controller;
                                                setStreaming(true); setLoading(true);
                                                const res = await streamMessage(fullPrompt, cid, controller.signal);
                                                let streamed = '';
                                                await readSseStream(res,
                                                    (delta) => {
                                                        streamed += delta;
                                                        const extracted = extractCodeBlocks(streamed);
                                                        if (extracted && !/ctrl\+f:/i.test(streamed)) {
                                                            setCodeText(extracted); addToHistory(extracted); setHasUnsavedChanges(true);
                                                            if (!activeCodeId) setUnsavedCode(extracted);
                                                            if (giveAiAccessToCode) setAccessLockedCode(extracted);
                                                            setCodeOpen(true);
                                                        }
                                                        const isCtrlF = /ctrl\+f:/i.test(streamed);
                                                        const extracted2 = extractCodeBlocks(streamed);
                                                        setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: isCtrlF ? streamed : extracted2 ? `[${preset.name} → open Code panel]` : stripCodeBlocks(streamed) } : msg));
                                                    },
                                                    (doneData) => { const finalCid = doneData?.conversationId || cid; if (finalCid) void refreshPluginRuns(finalCid); },
                                                    undefined, undefined, controller.signal,
                                                );
                                            } catch (err) { setError(err instanceof Error ? err.message : 'Preset failed'); }
                                            finally { setInlineActionBusy(false); setInlineActionLabel(null); setStreaming(false); setLoading(false); activeAssistantIdRef.current = null; abortRef.current = null; }
                                        }}
                                    >
                                        {inlineActionLabel === `preset-${preset.id}` ? '⏳' : `📋 ${preset.name}`}
                                    </button>
                                ))}

                                {/* ── Convert dropdown — Pro only ── */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        disabled={!codeText.trim() || inlineActionBusy}
                                        style={{
                                            padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
                                            border: '1px solid var(--border-default)',
                                            background: convertDropdownOpen ? 'var(--accent-glow)' : 'var(--bg-elevated)',
                                            color: convertDropdownOpen ? 'var(--accent)' : 'var(--text-secondary)',
                                            cursor: !codeText.trim() || inlineActionBusy ? 'not-allowed' : 'pointer',
                                            opacity: !codeText.trim() || inlineActionBusy ? 0.5 : 1,
                                            fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap',
                                        }}
                                        onClick={(e) => {
                                            if (userPlan !== 'pro') { setShowUpgradeModal(true); return; }
                                            const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                            setConvertDropdownPos({ top: r.bottom + 4, left: r.left });
                                            setConvertDropdownOpen(v => !v);
                                        }}
                                    >
                                        🔄 Convert ▾ {userPlan !== 'pro' && <span style={{ fontSize: '9px', marginLeft: '2px', opacity: 0.7 }}>✦ Pro</span>}
                                    </button>

                                    {convertDropdownOpen && (
                                        <div
                                            style={{ position: 'fixed', top: convertDropdownPos.top, left: convertDropdownPos.left, zIndex: 9999, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: '210px', overflow: 'auto', maxHeight: '60vh' }}
                                            onMouseLeave={() => setConvertDropdownOpen(false)}
                                        >
                                            {(() => {
                                                const allConversions: { from: string; to: string; lang: string; domains: string[] }[] = [
                                                    { from: 'Pine Script', to: 'Python', lang: 'Python', domains: ['pinescript'] },
                                                    { from: 'Pine Script', to: 'cTrader C#', lang: 'cTrader C#', domains: ['pinescript'] },
                                                    { from: 'Pine Script', to: 'MQL5', lang: 'MQL5', domains: ['pinescript'] },
                                                    { from: 'Pine Script', to: 'JavaScript', lang: 'JavaScript', domains: ['pinescript'] },
                                                    { from: 'Pine Script', to: 'TypeScript', lang: 'TypeScript', domains: ['pinescript'] },
                                                    { from: 'Python', to: 'Pine Script', lang: 'Pine Script v5', domains: ['python'] },
                                                    { from: 'Python', to: 'JavaScript', lang: 'JavaScript', domains: ['python'] },
                                                    { from: 'Python', to: 'TypeScript', lang: 'TypeScript', domains: ['python'] },
                                                    { from: 'Python', to: 'MQL5', lang: 'MQL5', domains: ['python'] },
                                                    { from: 'cTrader C#', to: 'Pine Script', lang: 'Pine Script v5', domains: ['ctrader'] },
                                                    { from: 'cTrader C#', to: 'Python', lang: 'Python', domains: ['ctrader'] },
                                                    { from: 'cTrader C#', to: 'MQL5', lang: 'MQL5', domains: ['ctrader'] },
                                                    { from: 'MQL5', to: 'Pine Script', lang: 'Pine Script v5', domains: ['mql5'] },
                                                    { from: 'MQL5', to: 'Python', lang: 'Python', domains: ['mql5'] },
                                                    { from: 'MQL5', to: 'cTrader C#', lang: 'cTrader C#', domains: ['mql5'] },
                                                    { from: 'JavaScript', to: 'TypeScript', lang: 'TypeScript', domains: ['javascript'] },
                                                    { from: 'JavaScript', to: 'Python', lang: 'Python', domains: ['javascript'] },
                                                    { from: 'TypeScript', to: 'JavaScript', lang: 'JavaScript', domains: ['typescript', 'react'] },
                                                    { from: 'TypeScript', to: 'Python', lang: 'Python', domains: ['typescript', 'react'] },
                                                    { from: 'C#', to: 'Python', lang: 'Python', domains: ['unity'] },
                                                    { from: 'C#', to: 'TypeScript', lang: 'TypeScript', domains: ['unity'] },
                                                    { from: 'Python', to: 'JavaScript', lang: 'JavaScript', domains: ['blender'] },
                                                    { from: 'Code', to: 'Python', lang: 'Python', domains: ['generic'] },
                                                    { from: 'Code', to: 'TypeScript', lang: 'TypeScript', domains: ['generic'] },
                                                    { from: 'Code', to: 'JavaScript', lang: 'JavaScript', domains: ['generic'] },
                                                ];
                                                return allConversions.filter(c => c.domains.includes(selectedDomain));
                                            })().map(({ from, to, lang }) => (
                                                <button
                                                    key={`${from}-${to}`}
                                                    type="button"
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                    onClick={async () => {
                                                        setConvertDropdownOpen(false);
                                                        if (!codeText.trim() || inlineActionBusy) return;
                                                        setInlineActionBusy(true);
                                                        setInlineActionLabel('🔄 Convert');
                                                        const projectContext = buildProjectContext();
                                                        const fullPrompt = `USER REQUEST:\nConvert the following code from ${from} to ${lang}. Output the FULL converted file with no truncation. Preserve all logic exactly.\n\nSOURCE CODE (${from}):\n\`\`\`\n${codeText.slice(0, 120000)}\n\`\`\`${projectContext}`;
                                                        try {
                                                            let cid = activeId;
                                                            if (!cid) { const newId = await startNewChat(); if (!newId) throw new Error('Failed to create conversation'); cid = newId; }
                                                            setMessages(m => [...m, { id: globalThis.crypto.randomUUID(), role: 'user', content: `🔄 Convert ${from} → ${to}` }]);
                                                            const assistantId = globalThis.crypto.randomUUID();
                                                            activeAssistantIdRef.current = assistantId;
                                                            setMessages(m => [...m, { id: assistantId, role: 'assistant', content: '' }]);
                                                            abortRef.current?.abort();
                                                            const controller = new AbortController();
                                                            abortRef.current = controller;
                                                            setStreaming(true); setLoading(true);
                                                            const res = await streamMessage(fullPrompt, cid, controller.signal);
                                                            let streamed = '';
                                                            await readSseStream(res,
                                                                (delta) => {
                                                                    streamed += delta;
                                                                    const extracted = extractCodeBlocks(streamed);
                                                                    if (extracted) {
                                                                        setCodeText(extracted); addToHistory(extracted); setHasUnsavedChanges(true); setCodeOpen(true);
                                                                        const domainMap: Record<string, string> = { 'Python': 'python', 'Pine Script': 'pinescript', 'Pine Script v5': 'pinescript', 'cTrader C#': 'ctrader', 'MQL5': 'mql5', 'JavaScript': 'javascript', 'TypeScript': 'typescript' };
                                                                        if (domainMap[to]) setSelectedDomain(domainMap[to]);
                                                                    }
                                                                    setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: extractCodeBlocks(streamed) ? `[Converted ${from} → ${to} → open Code panel]` : stripCodeBlocks(streamed) } : msg));
                                                                },
                                                                (doneData) => { const finalCid = doneData?.conversationId || cid; if (finalCid) void refreshPluginRuns(finalCid); },
                                                                undefined, undefined, controller.signal,
                                                            );
                                                        } catch (err) { setError(err instanceof Error ? err.message : 'Conversion failed'); }
                                                        finally { setInlineActionBusy(false); setInlineActionLabel(null); setStreaming(false); setLoading(false); activeAssistantIdRef.current = null; abortRef.current = null; }
                                                    }}
                                                >
                                                    <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{from} → {to}</span>
                                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{lang}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-3 overflow-y-auto pb-8">
                                {useMonaco ? (
                                    <div style={{ height: '55vh', border: '1px solid var(--border-default)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <MonacoEditor
                                            height="100%"
                                            language={
                                                selectedDomain === 'python' ? 'python'
                                                    : selectedDomain === 'react' ? 'typescript'
                                                        : selectedDomain === 'typescript' ? 'typescript'
                                                            : selectedDomain === 'javascript' ? 'javascript'
                                                                : selectedDomain === 'mql5' ? 'cpp'
                                                                    : selectedDomain === 'ctrader' ? 'csharp'
                                                                        : selectedDomain === 'unity' ? 'csharp'
                                                                            : 'plaintext'
                                            }
                                            theme={monacoTheme}
                                            value={codeText}
                                            options={{
                                                minimap: { enabled: monacoMinimap },
                                                fontSize: 12,
                                                lineHeight: 20,
                                                fontFamily: 'JetBrains Mono, monospace',
                                                scrollBeyondLastLine: false,
                                                wordWrap: 'on',
                                                automaticLayout: true,
                                                tabSize: 4,
                                                renderLineHighlight: 'line',
                                                smoothScrolling: true,
                                            }}
                                            onChange={(val: string | undefined) => {
                                                const newValue = val ?? '';
                                                setCodeText(newValue);
                                                addToHistory(newValue);
                                                runDiagnostics(newValue);
                                                if (activeCodeId) {
                                                    setHasUnsavedChanges(true);
                                                } else if (newValue.trim()) {
                                                    setUnsavedCode(newValue);
                                                    setHasUnsavedChanges(true);
                                                    setActiveCodeId(null);
                                                }
                                            }}
                                            onMount={(editor, monaco) => {
                                                monacoEditorRef.current = editor;
                                                monacoInstanceRef.current = monaco;
                                                runDiagnostics(codeText);

                                                // Subscribe to Monaco's own language diagnostics
                                                const syncMonacoMarkers = () => {
                                                    const model = editor.getModel();
                                                    if (!model) return;
                                                    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                                                    const monacoSeverityMap: Record<number, 'error' | 'warning' | 'info'> = {
                                                        8: 'error',   // MarkerSeverity.Error
                                                        4: 'warning', // MarkerSeverity.Warning
                                                        2: 'info',    // MarkerSeverity.Info
                                                        1: 'info',    // MarkerSeverity.Hint
                                                    };
                                                    const monacodiags: Diagnostic[] = markers.map((m: Monaco.editor.IMarker) => ({
                                                        line: m.startLineNumber,
                                                        col: m.startColumn,
                                                        endCol: m.endColumn,
                                                        severity: monacoSeverityMap[m.severity] ?? 'info',
                                                        message: m.message,
                                                        code: `MC${m.code ?? '000'}`,
                                                    }));
                                                    // Merge with custom linter results
                                                    const customDiags = lintCode(codeText, selectedDomain);
                                                    const merged = [...customDiags, ...monacodiags].sort((a, b) => {
                                                        const order = { error: 0, warning: 1, info: 2 };
                                                        return order[a.severity] - order[b.severity] || a.line - b.line;
                                                    });
                                                    setDiagnostics(merged);
                                                    if (merged.some(d => d.severity === 'error' || d.severity === 'warning')) {
                                                        setDiagnosticsOpen(true);
                                                    }
                                                };

                                                // Fire on every marker change (real-time)
                                                monaco.editor.onDidChangeMarkers((_uris: readonly Monaco.Uri[]) => syncMonacoMarkers());
                                                // Also run once immediately after mount
                                                setTimeout(syncMonacoMarkers, 1500);
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <textarea
                                        ref={codeTextareaRef}
                                        className="w-full h-[55vh] whitespace-pre font-mono break-words overflow-auto"
                                        style={{ background: '#0d0d10', color: '#e2e2e8', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '10px', fontSize: '12px', lineHeight: '1.7', fontFamily: 'JetBrains Mono, monospace', resize: 'none' }}
                                        value={codeText}
                                        placeholder="Paste code here, ask the AI, or type directly…"
                                        onChange={(e) => {
                                            const newValue = e.target.value;
                                            setCodeText(newValue);
                                            addToHistory(newValue);
                                            runDiagnostics(newValue);
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
                                                    addToHistory(pastedText);
                                                }
                                            }, 0);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Tab") {
                                                e.preventDefault();
                                                const el = e.currentTarget;
                                                const start = el.selectionStart ?? 0;
                                                const end = el.selectionEnd ?? 0;
                                                const insert = "  ";
                                                const next = codeText.slice(0, start) + insert + codeText.slice(end);
                                                setCodeText(next);
                                                addToHistory(next);
                                                requestAnimationFrame(() => {
                                                    el.selectionStart = el.selectionEnd = start + insert.length;
                                                });
                                            }
                                        }}
                                    />
                                )}

                                {showVersions && activeCodeId && (
                                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                {showDiffView ? 'Version Diff' : 'Version History'}
                                            </h4>
                                            <div className="flex items-center gap-2">
                                                {showDiffView && (
                                                    <button
                                                        type="button"
                                                        className="btn-secondary"
                                                        style={{ padding: '2px 8px', fontSize: '10px' }}
                                                        onClick={() => {
                                                            setShowDiffView(false);
                                                            setSelectedVersionId(null);
                                                            setCompareVersionId(null);
                                                        }}
                                                    >
                                                        ← Back
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                                                    onClick={() => {
                                                        setShowVersions(false);
                                                        setShowDiffView(false);
                                                        setSelectedVersionId(null);
                                                        setCompareVersionId(null);
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>

                                        {loadingSnippets ? (
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>Loading versions...</div>
                                        ) : snippetVersions.length > 0 ? (
                                            <>
                                                {/* Diff View */}
                                                {showDiffView && selectedVersionId && compareVersionId && (
                                                    <div className="mb-4">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-3">
                                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                                    Comparing v{getVersionNumberById(compareVersionId)}
                                                                    <span style={{ margin: '0 6px' }}>→</span>
                                                                    v{getVersionNumberById(selectedVersionId)}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    className="btn-secondary"
                                                                    style={{ padding: '2px 8px', fontSize: '10px' }}
                                                                    onClick={() => {
                                                                        // Swap comparison
                                                                        setSelectedVersionId(compareVersionId);
                                                                        setCompareVersionId(selectedVersionId);
                                                                    }}
                                                                >
                                                                    Swap
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div style={{
                                                            border: '1px solid var(--border-subtle)',
                                                            borderRadius: '6px',
                                                            overflow: 'hidden',
                                                            background: 'var(--bg-primary)',
                                                            maxHeight: '400px',
                                                            overflowY: 'auto'
                                                        }}>
                                                            {(() => {
                                                                const oldVersion = snippetVersions.find(v => v.id === compareVersionId);
                                                                const newVersion = snippetVersions.find(v => v.id === selectedVersionId);
                                                                if (!oldVersion || !newVersion) return null;

                                                                return (
                                                                    <DiffViewer
                                                                        oldValue={oldVersion.code}
                                                                        newValue={newVersion.code}
                                                                        splitView={true}
                                                                        useDarkTheme={theme === 'dark'}
                                                                        showDiffOnly={false}
                                                                        styles={{
                                                                            variables: {
                                                                                dark: {
                                                                                    diffViewerBackground: '#1e1e24',
                                                                                    diffViewerColor: '#e2e2e8',
                                                                                    addedBackground: 'rgba(34,197,94,0.15)',
                                                                                    addedColor: '#4ade80',
                                                                                    removedBackground: 'rgba(239,68,68,0.15)',
                                                                                    removedColor: '#f87171',
                                                                                    wordAddedBackground: 'rgba(34,197,94,0.3)',
                                                                                    wordRemovedBackground: 'rgba(239,68,68,0.3)',
                                                                                    addedGutterBackground: 'rgba(34,197,94,0.2)',
                                                                                    removedGutterBackground: 'rgba(239,68,68,0.2)',
                                                                                    gutterBackground: '#2a2a32',
                                                                                    gutterBackgroundDark: '#2a2a32',
                                                                                    highlightBackground: '#2a2a35',
                                                                                    highlightGutterBackground: '#2a2a35'
                                                                                }
                                                                            }
                                                                        }}
                                                                    />
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Version List */}
                                                {!showDiffView && (
                                                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                                                        {snippetVersions.map((version) => (
                                                            <div
                                                                key={version.id}
                                                                className="group relative"
                                                                style={{
                                                                    fontSize: '12px',
                                                                    padding: '8px',
                                                                    border: '1px solid var(--border-subtle)',
                                                                    borderRadius: '6px',
                                                                    background: 'var(--bg-elevated)',
                                                                    cursor: 'pointer',
                                                                    ...(selectedVersionId === version.id ? { borderColor: 'var(--accent)', background: 'var(--accent-glow)' } : {})
                                                                }}
                                                            >
                                                                <div className="flex justify-between items-start">
                                                                    <div className="flex-1">
                                                                        <div className="flex justify-between items-center mb-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                                    v{version.version_number}
                                                                                </span>
                                                                                <span style={{
                                                                                    fontSize: '9px',
                                                                                    padding: '2px 6px',
                                                                                    borderRadius: '10px',
                                                                                    background: 'var(--bg-hover)',
                                                                                    color: 'var(--text-muted)'
                                                                                }}>
                                                                                    {formatVersionSource(version.source)}
                                                                                </span>
                                                                            </div>
                                                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                                                {new Date(version.created_at).toLocaleDateString()}
                                                                            </span>
                                                                        </div>

                                                                        {version.change_summary && (
                                                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                                                                {version.change_summary}
                                                                            </div>
                                                                        )}

                                                                        {/* Action buttons */}
                                                                        <div className="flex items-center gap-1 mt-1">
                                                                            <button
                                                                                type="button"
                                                                                className="btn-secondary"
                                                                                style={{ padding: '2px 8px', fontSize: '10px' }}
                                                                                onClick={async (e) => {
                                                                                    e.stopPropagation();
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
                                                                                Restore
                                                                            </button>

                                                                            <button
                                                                                type="button"
                                                                                className="btn-secondary"
                                                                                style={{ padding: '2px 8px', fontSize: '10px' }}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (!selectedVersionId) {
                                                                                        setSelectedVersionId(version.id);
                                                                                    } else if (selectedVersionId === version.id) {
                                                                                        setSelectedVersionId(null);
                                                                                        setCompareVersionId(null);
                                                                                    } else if (!compareVersionId) {
                                                                                        setCompareVersionId(selectedVersionId);
                                                                                        setSelectedVersionId(version.id);
                                                                                        setShowDiffView(true);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                {selectedVersionId === version.id ? 'Cancel' : 'Compare'}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                                                No version history yet
                                            </div>
                                        )}
                                    </div>
                                )}
                                {/* ── Diagnostics Panel ── */}
                                {codeText.trim() && (
                                    <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
                                        {/* Header row */}
                                        <button
                                            type="button"
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}
                                            onClick={() => {
                                                runDiagnostics(codeText);
                                                setDiagnosticsOpen(v => !v);
                                            }}
                                        >
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
                                                🔎 Diagnostics
                                            </span>
                                            {/* Severity counts */}
                                            {diagnostics.filter(d => d.severity === 'error').length > 0 && (
                                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(248,113,113,0.15)', color: '#f87171', fontWeight: 700 }}>
                                                    🔴 {diagnostics.filter(d => d.severity === 'error').length}
                                                </span>
                                            )}
                                            {diagnostics.filter(d => d.severity === 'warning').length > 0 && (
                                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700 }}>
                                                    🟡 {diagnostics.filter(d => d.severity === 'warning').length}
                                                </span>
                                            )}
                                            {diagnostics.filter(d => d.severity === 'info').length > 0 && (
                                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 700 }}>
                                                    ℹ️ {diagnostics.filter(d => d.severity === 'info').length}
                                                </span>
                                            )}
                                            {diagnostics.length === 0 && (
                                                <span style={{ fontSize: '10px', color: '#4ade80' }}>✓ No issues</span>
                                            )}
                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{diagnosticsOpen ? '▲' : '▼'}</span>
                                        </button>

                                        {diagnosticsOpen && (
                                            <div>
                                                {/* Filter bar */}
                                                <div style={{ display: 'flex', gap: '4px', padding: '4px 10px', borderTop: '1px solid var(--border-subtle)' }}>
                                                    {(['all', 'error', 'warning', 'info'] as const).map(f => (
                                                        <button
                                                            key={f}
                                                            type="button"
                                                            onClick={() => setDiagnosticsFilter(f)}
                                                            style={{ padding: '2px 8px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-default)', background: diagnosticsFilter === f ? 'var(--accent-glow)' : 'none', color: diagnosticsFilter === f ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontWeight: diagnosticsFilter === f ? 700 : 400, textTransform: 'capitalize' }}
                                                        >
                                                            {f}
                                                        </button>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => runDiagnostics(codeText)}
                                                        style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                                        title="Re-run diagnostics"
                                                    >
                                                        ↺ Run
                                                    </button>
                                                </div>

                                                {/* Diagnostic list */}
                                                <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '4px 0' }}>
                                                    {(() => {
                                                        const filtered = diagnosticsFilter === 'all'
                                                            ? diagnostics
                                                            : diagnostics.filter(d => d.severity === diagnosticsFilter);

                                                        if (filtered.length === 0) {
                                                            return (
                                                                <div style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                                                    {diagnostics.length === 0 ? '✓ No issues found' : `No ${diagnosticsFilter}s`}
                                                                </div>
                                                            );
                                                        }

                                                        return filtered.map((d, i) => (
                                                            <div
                                                                key={i}
                                                                style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}
                                                                onClick={() => {
                                                                    // Jump to line in textarea
                                                                    const ta = codeTextareaRef.current;
                                                                    if (ta && !useMonaco) {
                                                                        const lines = codeText.split('\n');
                                                                        const charsBefore = lines.slice(0, d.line - 1).join('\n').length + (d.line > 1 ? 1 : 0);
                                                                        const charsToEnd = charsBefore + lines[d.line - 1].length;
                                                                        ta.focus();
                                                                        ta.setSelectionRange(charsBefore, charsToEnd);
                                                                        const lineHeight = 20;
                                                                        ta.scrollTop = Math.max(0, (d.line - 3) * lineHeight);
                                                                    }
                                                                    // Jump to line in Monaco
                                                                    if (useMonaco && monacoEditorRef.current) {
                                                                        monacoEditorRef.current.revealLineInCenter(d.line);
                                                                        monacoEditorRef.current.setPosition({ lineNumber: d.line, column: d.col });
                                                                        monacoEditorRef.current.focus();
                                                                    }
                                                                }}
                                                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                            >
                                                                <span style={{ fontSize: '11px', flexShrink: 0, marginTop: '1px' }}>{severityIcon(d.severity)}</span>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{ fontSize: '12px', color: severityColor(d.severity), lineHeight: 1.4 }}>{d.message}</div>
                                                                    <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Line {d.line} · {d.code}</span>
                                                                        {d.quickFix && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    const lines = codeText.split('\n');
                                                                                    lines[d.line - 1] = d.quickFix!.replacement;
                                                                                    const fixed = lines.join('\n');
                                                                                    setCodeText(fixed);
                                                                                    addToHistory(fixed);
                                                                                    setHasUnsavedChanges(true);
                                                                                    setTimeout(() => runDiagnostics(fixed), 50);
                                                                                }}
                                                                                style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '4px', border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.08)', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}
                                                                            >
                                                                                ⚡ {d.quickFix.label}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ));
                                                    })()}
                                                </div>
                                            </div>
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

            {/* Delete Project Confirm Modal */}
            {deleteProjectId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onMouseDown={() => setDeleteProjectId(null)}>
                    <div style={{ width: '380px', maxWidth: '95vw', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}
                        onMouseDown={e => e.stopPropagation()}>
                        <div style={{ padding: '20px 20px 0' }}>
                            <div style={{ fontSize: '28px', marginBottom: '10px' }}>🗑️</div>
                            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '6px' }}>Delete project?</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                                This will permanently delete the project and all its files. Conversations will be unassigned but not deleted.
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', padding: '0 20px 20px', justifyContent: 'flex-end' }}>
                            <button type="button"
                                onClick={() => setDeleteProjectId(null)}
                                style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                Cancel
                            </button>
                            <button type="button"
                                onClick={() => void confirmDeleteProject()}
                                style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Project Modal */}
            {showNewProjectModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onMouseDown={() => { if (!newProjectLoading) setShowNewProjectModal(false); }}>
                    <div
                        style={{ width: '460px', maxWidth: '95vw', borderRadius: '14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>📁 New Project</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Choose how to set up your project</div>
                        </div>

                        {/* Mode toggle */}
                        <div style={{ padding: '16px 20px 0' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="button"
                                    onClick={() => setNewProjectMode('manual')}
                                    style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: `2px solid ${newProjectMode === 'manual' ? 'var(--accent)' : 'var(--border-default)'}`, background: newProjectMode === 'manual' ? 'rgba(249,115,22,0.08)' : 'var(--bg-elevated)', color: newProjectMode === 'manual' ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
                                    ✏️ Manual
                                    <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>Name it and start fresh</div>
                                </button>
                                <button type="button"
                                    onClick={() => setNewProjectMode('ai_tree')}
                                    style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: `2px solid ${newProjectMode === 'ai_tree' ? 'var(--accent)' : 'var(--border-default)'}`, background: newProjectMode === 'ai_tree' ? 'rgba(249,115,22,0.08)' : 'var(--bg-elevated)', color: newProjectMode === 'ai_tree' ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
                                    🌳 AI Full Tree
                                    <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>AI scaffolds branches for you</div>
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div style={{ padding: '16px 20px 20px' }}>
                            {newProjectMode === 'manual' ? (
                                <>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Project name</div>
                                    <input
                                        autoFocus
                                        style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}
                                        placeholder="e.g. Trading Bot, Game Dev, Web App..."
                                        value={newProjectName}
                                        onChange={(e) => setNewProjectName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') void submitNewProject(); if (e.key === 'Escape') setShowNewProjectModal(false); }}
                                    />
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Describe your project</div>
                                    <textarea
                                        autoFocus
                                        style={{ width: '100%', minHeight: '90px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif', resize: 'vertical', lineHeight: '1.5' }}
                                        placeholder="e.g. A Unity 2D game with a player, enemies, inventory system, and save/load functionality..."
                                        value={newProjectPrompt}
                                        onChange={(e) => setNewProjectPrompt(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Escape') setShowNewProjectModal(false); }}
                                    />
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                                        ⚡ AI will generate a project name, description, AI instructions, and a conversation branch for each major area.
                                    </div>
                                </>
                            )}

                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                                <button type="button"
                                    disabled={newProjectLoading}
                                    onClick={() => setShowNewProjectModal(false)}
                                    style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                    Cancel
                                </button>
                                <button type="button"
                                    disabled={newProjectLoading || (newProjectMode === 'manual' ? !newProjectName.trim() : !newProjectPrompt.trim())}
                                    onClick={() => void submitNewProject()}
                                    style={{ padding: '7px 18px', fontSize: '13px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: (newProjectLoading || (newProjectMode === 'manual' ? !newProjectName.trim() : !newProjectPrompt.trim())) ? 'not-allowed' : 'pointer', opacity: (newProjectLoading || (newProjectMode === 'manual' ? !newProjectName.trim() : !newProjectPrompt.trim())) ? 0.6 : 1, fontFamily: 'DM Sans, sans-serif', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {newProjectLoading ? (
                                        <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating...</>
                                    ) : (
                                        newProjectMode === 'manual' ? 'Create' : '🌳 Generate Tree'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Upgrade Modal */}
            {showUpgradeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onMouseDown={() => setShowUpgradeModal(false)}>
                    <div style={{ width: '420px', maxWidth: '95vw', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}
                        onMouseDown={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(249,115,22,0.05))', borderBottom: '1px solid var(--border-subtle)', padding: '24px 24px 20px' }}>
                            <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚡</div>
                            <div style={{ fontWeight: 700, fontSize: '20px', color: 'var(--text-primary)', marginBottom: '6px' }}>Upgrade to Pro</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Unlock unlimited access with T4N Pro.</div>
                        </div>
                        {/* Features */}
                        <div style={{ padding: '20px 24px' }}>
                            {[
                                { icon: '🔬', text: 'AI Code Review' },
                                { icon: '🐛', text: 'Debug Mode' },
                                { icon: '🧪', text: 'Test Generation' },
                                { icon: '🏗️', text: 'Project Analysis' },
                                { icon: '🔀', text: 'Multi-File Refactor' },
                                { icon: '🚀', text: 'DevOps Assistant' },
                                { icon: '💬', text: 'Codebase Chat' },
                                { icon: '🔄', text: 'Smart Code Conversion' },
                                { icon: '🧠', text: 'AI Memory (learns your style)' },
                                { icon: '⚡', text: 'Higher usage limits (500/day)' },
                            ].map(({ icon, text }) => (
                                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <span>{icon}</span><span>{text}</span>
                                </div>
                            ))}
                        </div>
                        {/* Actions */}
                        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button type="button"
                                disabled={checkoutLoading}
                                onClick={() => void startCheckout()}
                                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: checkoutLoading ? 'not-allowed' : 'pointer', opacity: checkoutLoading ? 0.7 : 1, fontFamily: 'DM Sans, sans-serif' }}>
                                {checkoutLoading ? 'Redirecting…' : '🚀 Upgrade Now'}
                            </button>
                            <button type="button"
                                onClick={() => setShowUpgradeModal(false)}
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                Maybe later
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Preset Modal */}
            {showPresetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onMouseDown={() => { setShowPresetModal(false); setPresetModalMode('save'); setEditingPreset(null); }}>
                    <div
                        style={{ width: '420px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                                {presetModalMode === 'save' ? '⭐ Save as Preset' : '📋 Manage Presets'}
                            </div>
                        </div>

                        <div style={{ padding: '20px' }}>
                            {presetModalMode === 'save' ? (
                                <>
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Preset Name</div>
                                        <input
                                            autoFocus
                                            style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}
                                            placeholder="e.g. Convert Pine to Python"
                                            value={presetNameInput}
                                            onChange={(e) => setPresetNameInput(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Prompt Template</div>
                                        <textarea
                                            style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', minHeight: '100px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}
                                            placeholder="Enter the prompt you want to save..."
                                            value={presetPromptInput}
                                            onChange={(e) => setPresetPromptInput(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: '6px' }}>
                                        <span style={{ fontWeight: 600 }}>Tip:</span> You can use placeholders like {String.fromCharCode(123) + 'code' + String.fromCharCode(125)} or {String.fromCharCode(123) + 'language' + String.fromCharCode(125)} in your prompts.
                                    </div>
                                </>
                            ) : (
                                <>
                                    {promptPresets.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                            No presets saved yet.
                                        </div>
                                    ) : (
                                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                            {promptPresets.map(preset => (
                                                <div key={preset.id} style={{ marginBottom: '8px', padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{preset.name}</span>
                                                        <div style={{ display: 'flex', gap: '4px' }}>
                                                            <button
                                                                type="button"
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', padding: '2px 6px' }}
                                                                onClick={() => {
                                                                    setEditingPreset(preset);
                                                                    setPresetNameInput(preset.name);
                                                                    setPresetPromptInput(preset.prompt);
                                                                    setPresetModalMode('save');
                                                                }}
                                                                title="Edit"
                                                            >
                                                                ✏️
                                                            </button>
                                                            <button
                                                                type="button"
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#f87171', padding: '2px 6px' }}
                                                                onClick={() => deletePreset(preset.id)}
                                                                title="Delete"
                                                            >
                                                                🗑️
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxHeight: '40px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {preset.prompt.length > 60 ? preset.prompt.slice(0, 60) + '…' : preset.prompt}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                            {presetModalMode === 'save' ? (
                                <>
                                    <button
                                        type="button"
                                        style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                        onClick={() => { setShowPresetModal(false); setPresetNameInput(''); setPresetPromptInput(''); }}
                                    >
                                        Cancel
                                    </button>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            type="button"
                                            style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                            onClick={() => { setPresetModalMode('manage'); setEditingPreset(null); }}
                                        >
                                            Manage
                                        </button>
                                        <button
                                            type="button"
                                            style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', opacity: (!presetNameInput.trim() || !presetPromptInput.trim()) ? 0.5 : 1 }}
                                            disabled={!presetNameInput.trim() || !presetPromptInput.trim()}
                                            onClick={() => {
                                                if (editingPreset) {
                                                    // Update existing
                                                    setPromptPresets(prev => prev.map(p =>
                                                        p.id === editingPreset.id
                                                            ? { ...p, name: presetNameInput.trim(), prompt: presetPromptInput.trim() }
                                                            : p
                                                    ));
                                                } else {
                                                    // Save new
                                                    savePreset(presetNameInput, presetPromptInput);
                                                }
                                                setEditingPreset(null);
                                                setPresetNameInput('');
                                                setPresetPromptInput('');
                                                setShowPresetModal(false);
                                            }}
                                        >
                                            {editingPreset ? 'Update' : 'Save'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                        onClick={() => setShowPresetModal(false)}
                                    >
                                        Close
                                    </button>
                                    <button
                                        type="button"
                                        style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                        onClick={() => { setPresetModalMode('save'); setEditingPreset(null); setPresetNameInput(''); setPresetPromptInput(''); }}
                                    >
                                        + New Preset
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Rename Snippet Modal */}
            {renameModalId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onMouseDown={() => { setRenameModalId(null); setRenameModalValue(''); }}>
                    <div
                        style={{ width: '320px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)', padding: '20px' }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>{renameModalId === '__new__' ? '💾 Name your snippet' : '✏️ Rename snippet'}</div>
                        {renameModalId === '__new__' && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Give this file a name before saving</div>}
                        <input
                            autoFocus
                            style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}
                            value={renameModalValue}
                            onChange={(e) => setRenameModalValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitRename();
                                if (e.key === 'Escape') { setRenameModalId(null); setRenameModalValue(''); }
                            }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button"
                                style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                onClick={() => { setRenameModalId(null); setRenameModalValue(''); }}>
                                Cancel
                            </button>
                            <button type="button"
                                style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                                onClick={() => void commitRename()}>
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}