"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function BillingSuccess() {
    const router = useRouter();
    const [debugInfo, setDebugInfo] = useState<string>("");

    useEffect(() => {
        const run = async () => {
            console.log("🔍 BillingSuccess page loaded");
            
            try {
                const params = new URLSearchParams(window.location.search);
                const session_id = params.get("session_id");
                
                console.log("🔍 Session ID from URL:", session_id);
                setDebugInfo(`Session ID: ${session_id || 'none'}`);

                if (!session_id) {
                    console.error("❌ No session_id found in URL");
                    setDebugInfo(prev => prev + " | No session_id");
                    setTimeout(() => router.push("/"), 1500);
                    return;
                }

                console.log("🔍 Getting Supabase session...");
                const { data, error: sessionError } = await supabase.auth.getSession();
                
                if (sessionError) {
                    console.error("❌ Supabase session error:", sessionError);
                    setDebugInfo(prev => prev + " | Auth error");
                    setTimeout(() => router.push("/"), 1500);
                    return;
                }
                
                const accessToken = data.session?.access_token;
                console.log("🔍 Access token present:", !!accessToken);
                
                if (!accessToken) {
                    console.error("❌ No access token found");
                    setDebugInfo(prev => prev + " | No token");
                    setTimeout(() => router.push("/"), 1500);
                    return;
                }

                const apiUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/billing/verify-session?session_id=${encodeURIComponent(session_id)}`;
                console.log("🔍 Calling verify-session URL:", apiUrl);
                
                const response = await fetch(apiUrl, {
                    method: "GET",
                    headers: {
                        "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "",
                        "Authorization": `Bearer ${accessToken}`,
                    },
                });

                console.log("🔍 Response status:", response.status);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log("✅ Verify-session response:", data);
                    setDebugInfo(prev => prev + ` | Upgraded: ${data.upgraded}`);
                } else {
                    console.error("❌ Verify-session failed with status:", response.status);
                    const errorText = await response.text();
                    console.error("❌ Error response:", errorText);
                    setDebugInfo(prev => prev + ` | Error ${response.status}`);
                }
            } catch (error) {
                // Fix: properly type the error
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error("❌ Exception in billing success:", errorMessage);
                setDebugInfo(prev => prev + ` | Exception: ${errorMessage}`);
            } finally {
                console.log("🔍 Redirecting to home in 1.5 seconds");
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
            {process.env.NODE_ENV === 'development' && (
                <div style={{ color: '#666', fontSize: '12px', marginTop: '20px' }}>
                    Debug: {debugInfo}
                </div>
            )}
        </div>
    );
}