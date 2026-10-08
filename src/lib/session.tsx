"use client";

// Сессия: авторизация через Telegram initData → JWT от auth-verify →
// Supabase-клиент с этим токеном. Realtime-канал превращает любые изменения
// БД (например, голосовую запись через бота) в событие planner:refresh.

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
import { getWebApp } from "@/lib/telegram";

export const REFRESH_EVENT = "planner:refresh";

export function emitRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onPlannerRefresh(fn: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, fn);
  return () => window.removeEventListener(REFRESH_EVENT, fn);
}

type Status = "loading" | "ready" | "error";
type SessionCtx = { sb: SupabaseClient | null; status: Status; userId: number | null };

const Ctx = createContext<SessionCtx>({ sb: null, status: "loading", userId: null });

export const useSession = () => useContext(Ctx);

const TOKEN_KEY = "planner.token";
const TOKEN_TTL_GUARD_SEC = 3600; // если токен живёт меньше часа — перевыпускаем

type Cached = { token: string; exp: number };

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

async function requestToken(): Promise<Cached> {
  const initData = getWebApp()?.initData ?? "";
  let body: unknown;
  if (initData) {
    body = { initData };
  } else if (process.env.NEXT_PUBLIC_DEV_TG_ID) {
    // Локальная разработка в браузере: вход по dev-режиму на бэкенде.
    body = { dev: true, tg_id: Number(process.env.NEXT_PUBLIC_DEV_TG_ID) };
  } else {
    throw new Error("opened outside Telegram without initData");
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_FUNCTIONS_URL}/auth-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth-verify: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return { token: data.token, exp: jwtExp(data.token) };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [userId, setUserId] = useState<number | null>(null);
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
    if (!sb || !process.env.NEXT_PUBLIC_FUNCTIONS_URL) {
      setStatus("error");
      return;
    }
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

        const payload = JSON.parse(
          atob(cached.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        ) as { tg_id?: number };
        setUserId(Number(payload.tg_id));

        const webApp = getWebApp();
        webApp?.ready();
        webApp?.expand();
        try {
          webApp?.setHeaderColor("#F6F6F4");
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
        if (alive) setStatus("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [sb]);

  if (status !== "ready") {
    return (
      <p className="pt-24 text-center text-[13px] text-mute">
        {status === "loading" ? "…" : "Открой приложение из Telegram"}
      </p>
    );
  }

  return <Ctx.Provider value={{ sb, status, userId }}>{children}</Ctx.Provider>;
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
