import { ThemeProvider } from '@/components/branding/ThemeProvider';
import Footer from '@/components/Footer';
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
      <body style={{ background: '#0f0f11', margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ThemeProvider>
          <main style={{ flex: 1 }}>
            {children}
          </main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}