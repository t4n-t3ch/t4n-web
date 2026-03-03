"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BillingSuccess() {
    const router = useRouter();

    useEffect(() => {
        setTimeout(() => router.push("/"), 3000);
    }, [router]);

    return (
        <div style={{ background: '#0f0f11', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '48px' }}>🎉</div>
            <div style={{ color: '#4ade80', fontSize: '24px', fontWeight: 700 }}>You&apos;re now Pro!</div>
            <div style={{ color: '#9ca3af', fontSize: '14px' }}>Redirecting you back to T4N…</div>
        </div>
    );
}