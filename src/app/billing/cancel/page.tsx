"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BillingCancel() {
    const router = useRouter();

    useEffect(() => {
        const t = setTimeout(() => router.push("/"), 3000);
        return () => clearTimeout(t);
    }, [router]);

    return (
        <div style={{
            background: '#0f0f11', height: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: '16px'
        }}>
            <div style={{ fontSize: '48px' }}>↩</div>
            <div style={{ color: '#9ca3af', fontSize: '24px', fontWeight: 700 }}>
                Checkout cancelled
            </div>
            <div style={{ color: '#6b7280', fontSize: '14px' }}>
                No charge was made. Redirecting you back…
            </div>
        </div>
    );
}