import { ThemeProvider } from '@/components/branding/ThemeProvider';
import Footer from '@/components/Footer';
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "T4N - AI Engineering Assistant",
  description: "Specialized AI for coding, trading, and Pine Script",
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
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