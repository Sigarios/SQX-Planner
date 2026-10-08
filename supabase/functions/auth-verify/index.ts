// Авторизация Mini App: принимает Telegram initData, проверяет подпись
// и выпускает Supabase-совместимый JWT (HS256, секрет проекта).
// Роль "authenticated" + клейм tg_id — под это написаны RLS-политики.

import { corsHeaders, json } from "../_shared/http.ts";
import { signJwt } from "../_shared/jwt.ts";
import { verifyInitData } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json();
    let tgId: number;
    let name = "";

    // ALLOW_DEV_AUTH=true открывает вход без initData — только для локальной
    // разработки в браузере. В проде держим выключенным.
    if (body?.dev === true && Deno.env.get("ALLOW_DEV_AUTH") === "true") {
      tgId = Number(body.tg_id);
      name = "dev";
    } else {
      const user = await verifyInitData(
        String(body?.initData ?? ""),
        Deno.env.get("TELEGRAM_BOT_TOKEN")!,
      );
      tgId = user.id;
      name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    }

    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!secret) {
      return json(
        {
          error:
            "SUPABASE_JWT_SECRET is not set. Скопируй Legacy JWT Secret в Supabase Dashboard → Settings → API → JWT Settings и выполни: supabase secrets set SUPABASE_JWT_SECRET=<secret>",
        },
        500,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        sub: String(tgId),
        tg_id: tgId,
        role: "authenticated",
        aud: "authenticated",
        iat: now,
        exp: now + 7 * 24 * 3600,
      },
      secret,
    );
    return json({ token, user: { id: tgId, name } });
  } catch (e) {
    return json({ error: (e as Error).message }, 401);
  }
});
