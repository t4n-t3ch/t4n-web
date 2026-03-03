"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BillingSuccess() {
    const router = useRouter();

    useEffect(() => {
        const run = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const session_id = params.get("session_id");

                if (session_id) {
                    // ✅ verifies payment + upgrades user to pro (fallback if webhook missed)
                    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/billing/verify-session?session_id=${encodeURIComponent(session_id)}`, {
                        method: "GET",
                        headers: {
                            "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "",
                            "Authorization": `Bearer ${localStorage.getItem("sb-access-token") || ""}`,
                        },
                    });
                }
            } catch {
                // ignore — user will still be redirected
            } finally {
                setTimeout(() => router.push("/"), 1500);
            }
        };

        run();
    }, [router]);

    return (
        <div style={{ background: '#0f0f11', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '48px' }}>🎉</div>
            <div style={{ color: '#4ade80', fontSize: '24px', fontWeight: 700 }}>You&apos;re now Pro!</div>
            <div style={{ color: '#9ca3af', fontSize: '14px' }}>Redirecting you back to T4N…</div>
        </div>
    );
}