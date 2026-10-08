// Тонкая типизированная обёртка над Telegram WebApp SDK.

export type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  HapticFeedback?: {
    selectionChanged(): void;
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  };
};

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

/**
 * Скрипт telegram-web-app.js подключается с beforeInteractive, но на медленной
 * сети может прийти с задержкой — коротко подождём его, прежде чем решить,
 * что приложение открыто вне Telegram.
 */
export async function waitForWebApp(timeoutMs = 2000): Promise<TelegramWebApp | null> {
  const immediate = getWebApp();
  if (immediate) return immediate;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const webApp = getWebApp();
    if (webApp) return webApp;
  }
  return null;
}

export function hapticTap(): void {
  try {
    getWebApp()?.HapticFeedback?.selectionChanged();
  } catch {
    // вне Telegram — просто молча пропускаем
  }
}
