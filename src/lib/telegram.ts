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

export function hapticTap(): void {
  try {
    getWebApp()?.HapticFeedback?.selectionChanged();
  } catch {
    // вне Telegram — просто молча пропускаем
  }
}
