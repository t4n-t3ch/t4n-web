import { ThemeProvider } from '@/components/branding/ThemeProvider';
import { Logo } from '@/components/branding/Logo';
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <ThemeProvider>
          <header className="border-b border-gray-200">
            <div className="container mx-auto px-4 py-3">
              <Logo />
            </div>
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}