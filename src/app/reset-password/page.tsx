"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

function validatePassword(pw: string): string[] {
    const errors: string[] = [];
    if (pw.length < 8) errors.push('at least 8 characters');
    if (!/[A-Z]/.test(pw)) errors.push('an uppercase letter');
    if (!/[a-z]/.test(pw)) errors.push('a lowercase letter');
    if (!/[0-9]/.test(pw)) errors.push('a number');
    if (!/[^A-Za-z0-9]/.test(pw)) errors.push('a special character');
    return errors;
}

export default function ResetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        // Handle both PKCE (code param) and implicit (hash) flows
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") setReady(true);
        });

        // PKCE flow — exchange the code in the URL for a session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) setReady(true);
        });

        return () => subscription.unsubscribe();
    }, []);

    const pwErrors = password ? validatePassword(password) : [];
    const matchError = confirm && password !== confirm;
    const isValid = pwErrors.length === 0 && !matchError && password.length > 0 && confirm.length > 0;

    const rules = [
        { label: '8+ characters', test: /^.{8,}$/ },
        { label: 'Uppercase (A–Z)', test: /[A-Z]/ },
        { label: 'Lowercase (a–z)', test: /[a-z]/ },
        { label: 'Number (0–9)', test: /[0-9]/ },
        { label: 'Special character', test: /[^A-Za-z0-9]/ },
    ];

    async function handleSubmit() {
        if (!isValid) return;
        setLoading(true);
        setStatus(null);
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
            setStatus(`⚠ ${error.message}`);
            setLoading(false);
        } else {
            setStatus("✅ Password updated! Redirecting to login…");
            setTimeout(() => router.push("/"), 2000);
        }
    }

    return (
        <div style={{ minHeight: '100vh', background: '#0f0f11', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{ width: '380px', background: '#1e1e24', border: '1px solid #2a2a35', borderRadius: 12, padding: 32 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f97316', marginBottom: 8 }}>T4N</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e2e8', marginBottom: 4 }}>Reset Your Password</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 24 }}>Enter a new password for your account.</div>

                {!ready && !status && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Verifying reset link…</div>
                )}

                {status && (
                    <div style={{ background: status.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${status.startsWith('✅') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: status.startsWith('✅') ? '#4ade80' : '#f87171', marginBottom: 16 }}>
                        {status}
                    </div>
                )}

                {ready && (
                    <>
                        <input type="password" placeholder="New password" value={password}
                            onChange={e => setPassword(e.target.value)}
                            style={{ width: '100%', background: '#0f0f11', border: `1px solid ${password && pwErrors.length === 0 ? 'rgba(34,197,94,0.5)' : password && pwErrors.length > 0 ? 'rgba(239,68,68,0.4)' : '#2a2a35'}`, borderRadius: 6, padding: '10px 12px', color: '#e2e2e8', fontSize: 13, marginBottom: 10, boxSizing: 'border-box' as const }} />

                        {password.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                                {rules.map(r => { const passed = r.test.test(password); return (
                                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: passed ? '#4ade80' : '#6b7280' }}>
                                        <span>{passed ? '✓' : '○'}</span>{r.label}
                                    </div>
                                ); })}
                            </div>
                        )}

                        <input type="password" placeholder="Confirm new password" value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            style={{ width: '100%', background: '#0f0f11', border: `1px solid ${matchError ? 'rgba(239,68,68,0.4)' : confirm && !matchError ? 'rgba(34,197,94,0.5)' : '#2a2a35'}`, borderRadius: 6, padding: '10px 12px', color: '#e2e2e8', fontSize: 13, marginBottom: 4, boxSizing: 'border-box' as const }} />
                        {matchError && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 12 }}>Passwords do not match</p>}

                        <button disabled={!isValid || loading} onClick={handleSubmit}
                            style={{ width: '100%', background: isValid ? '#f97316' : '#2a2a35', border: 'none', borderRadius: 6, padding: '10px 0', color: isValid ? '#fff' : '#6b7280', fontWeight: 600, fontSize: 14, cursor: isValid ? 'pointer' : 'not-allowed', marginTop: 12, opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Updating…' : 'Set New Password'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}