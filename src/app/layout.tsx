import { ThemeProvider } from '@/components/branding/ThemeProvider';
import { Logo } from '@/components/branding/Logo';
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "T4N - AI Engineering Assistant",
  description: "Specialized AI for coding, trading, and Pine Script",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ background: '#0f0f11', margin: 0 }}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}