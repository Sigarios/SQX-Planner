"use client";

// Сессия: авторизация через Telegram initData → JWT от auth-verify →
// Supabase-клиент с этим токеном. Realtime-канал превращает любые изменения
// БД (например, голосовую запись через бота) в событие planner:refresh.
//
// Ошибки старта разделяются на три вида, и на экране показывается точная
// причина:
//   config   — при сборке не вшились NEXT_PUBLIC_* (проблема в Vercel);
//   telegram — приложение открыто вне Telegram и dev-вход не настроен;
//   auth     — auth-verify отклонил вход (например, старый токен бота).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getWebApp, waitForWebApp } from "@/lib/telegram";

export const REFRESH_EVENT = "planner:refresh";

export function emitRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onPlannerRefresh(fn: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, fn);
  return () => window.removeEventListener(REFRESH_EVENT, fn);
}

type Status = "loading" | "ready" | "error";
type ErrorKind = "config" | "telegram" | "auth";

type StartError = { kind: ErrorKind; title: string; detail: string };

class StartErrorImpl extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly title: string,
    detail: string,
  ) {
    super(detail);
  }
}

const CONFIG_HINT =
  "Переменные NEXT_PUBLIC_* вшиваются в бандл на этапе сборки: добавь их в Vercel → Settings → Environment Variables и обязательно сделай Redeploy.";

const Ctx = createContext<{
  sb: SupabaseClient | null;
  status: Status;
  userId: number | null;
  error: StartError | null;
}>({ sb: null, status: "loading", userId: null, error: null });

export const useSession = () => useContext(Ctx);

const TOKEN_KEY = "planner.token";
const TOKEN_TTL_GUARD_SEC = 3600; // если токен живёт меньше часа — перевыпускаем

type Cached = { token: string; exp: number };

function b64Json<T>(segment: string): T {
  return JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/"))) as T;
}

function jwtExp(token: string): number {
  try {
    return Number(b64Json<{ exp?: number }>(token.split(".")[1]).exp) || 0;
  } catch {
    return 0;
  }
}

async function requestToken(): Promise<Cached> {
  // SDK обычно уже загружен (beforeInteractive), но подождём до 2 секунд.
  const webApp = await waitForWebApp();
  const initData = webApp?.initData ?? "";
  const devId = process.env.NEXT_PUBLIC_DEV_TG_ID;

  let body: unknown;
  if (initData) {
    body = { initData };
  } else if (devId) {
    // Локальная разработка в браузере: вход по dev-режиму на бэкенде.
    body = { dev: true, tg_id: Number(devId) };
  } else {
    throw new StartErrorImpl(
      "telegram",
      "Открой приложение из Telegram",
      "window.Telegram.WebApp не найден, initData пуст, dev-вход не настроен (NEXT_PUBLIC_DEV_TG_ID).",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${process.env.NEXT_PUBLIC_FUNCTIONS_URL}/auth-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new StartErrorImpl(
      "auth",
      "auth-verify недоступен",
      `Не удалось выполнить запрос: ${(e as Error).message}`,
    );
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    const badSignature = /signature|hash/i.test(text);
    throw new StartErrorImpl(
      "auth",
      `auth-verify: ${res.status}`,
      badSignature
        ? `${text} — проверь секрет TELEGRAM_BOT_TOKEN в Supabase: после Revoke там должен лежать НОВЫЙ токен бота.`
        : text || "сервер не вернул деталей",
    );
  }

  const data = (await res.json()) as { token: string };
  return { token: data.token, exp: jwtExp(data.token) };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [userId, setUserId] = useState<number | null>(null);
  const [error, setError] = useState<StartError | null>(null);
  const tokenRef = useRef<string | null>(null);

  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => tokenRef.current,
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }, []);

  useEffect(() => {
    // Только литеральные обращения к process.env.NEXT_PUBLIC_* — динамическая
    // доступ по имени Next.js не инлайнит в клиентский бандл.
    const missing = (
      [
        ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
        ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
        ["NEXT_PUBLIC_FUNCTIONS_URL", process.env.NEXT_PUBLIC_FUNCTIONS_URL],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (!sb || missing.length > 0) {
      setError({
        kind: "config",
        title: "Ошибка конфигурации сборки",
        detail: `Не заданы: ${missing.join(", ")}. ${CONFIG_HINT}`,
      });
      setStatus("error");
      return;
    }

    // Сообщаем Telegram, что UI готов, сразу — чтобы скрыть родной загрузчик.
    const webApp = getWebApp();
    webApp?.ready();
    webApp?.expand();

    let alive = true;
    (async () => {
      try {
        const raw = localStorage.getItem(TOKEN_KEY);
        let cached: Cached | null = raw ? (JSON.parse(raw) as Cached) : null;
        if (!cached || cached.exp - Date.now() / 1000 < TOKEN_TTL_GUARD_SEC) {
          cached = await requestToken();
          localStorage.setItem(TOKEN_KEY, JSON.stringify(cached));
        }
        if (!alive) return;
        tokenRef.current = cached.token;

        setUserId(Number(b64Json<{ tg_id?: number }>(cached.token.split(".")[1]).tg_id));

        try {
          getWebApp()?.setHeaderColor("#F6F6F4");
        } catch {
          // старые клиенты не умеют setHeaderColor
        }

        sb
          .channel("planner-db")
          .on("postgres_changes", { event: "*", schema: "public" }, () => emitRefresh())
          .subscribe();

        setStatus("ready");
      } catch (e) {
        console.error("session bootstrap failed:", e);
        if (!alive) return;
        setError(
          e instanceof StartErrorImpl
            ? { kind: e.kind, title: e.title, detail: e.message }
            : {
                kind: "auth",
                title: "Не удалось запустить приложение",
                detail: (e as Error).message,
              },
        );
        setStatus("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [sb]);

  if (status !== "ready") {
    if (status === "loading") {
      return <p className="pt-24 text-center text-[13px] text-mute">…</p>;
    }

    return (
      <div className="mx-auto max-w-md px-6 pt-24">
        <p className="text-[15px] font-semibold">
          {error?.title ?? "Не удалось запустить приложение"}
        </p>
        {error?.detail && (
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-snug text-mute">
            {error.detail}
          </p>
        )}
        {error?.kind === "config" && (
          <p className="mt-3 text-[13px] text-mute">
            Текущие значения: URL = {process.env.NEXT_PUBLIC_SUPABASE_URL ?? "—"}, Functions ={" "}
            {process.env.NEXT_PUBLIC_FUNCTIONS_URL ?? "—"}.
          </p>
        )}
      </div>
    );
  }

  return <Ctx.Provider value={{ sb, status, userId, error }}>{children}</Ctx.Provider>;
}

/**
 * Загрузка данных + автообновление по realtime/фокусу/вкладке.
 * loader передавай через useCallback, иначе эффект будет перезапускаться
 * на каждом рендере.
 */
export function usePlannerData<T>(loader: (sb: SupabaseClient) => Promise<T>) {
  const { sb } = useSession();
  const [data, setData] = useState<T | null>(null);

  const load = useCallback(
    async () => {
      if (!sb) return;
      try {
        setData(await loader(sb));
      } catch (e) {
        console.error("load failed:", e);
      }
    },
    [sb, loader],
  );

  useEffect(() => {
    load();
    const off = onPlannerRefresh(load);
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return { data, reload: load };
}
