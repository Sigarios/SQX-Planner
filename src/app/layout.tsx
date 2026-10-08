import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "Планер",
  description: "Личный планер и трекер",
};

export const viewport: Viewport = {
  themeColor: "#F6F6F4",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <SessionProvider>
          <main className="mx-auto w-full max-w-md px-4 pt-5 pb-20">{children}</main>
          <BottomNav />
        </SessionProvider>
      </body>
    </html>
  );
}
