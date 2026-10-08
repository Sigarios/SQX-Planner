// Проверка Telegram initData и тонкие обёртки Bot API.

export type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Проверяет подпись initData по официальной схеме:
 *   secret_key      = HMAC_SHA256(key="WebAppData",      data=bot_token)
 *   expected_hash   = HMAC_SHA256(key=secret_key,        data=data_check_string)
 * data_check_string — все поля initData (кроме hash), отсортированные по ключу.
 * Бросает ошибку, если подпись неверна или initData старше maxAgeSec секунд.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86_400,
): Promise<TgUser> {
  if (!initData) throw new Error("initData is empty");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData: no hash");

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    throw new Error("initData expired");
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();
  const hmac = async (key: BufferSource, msg: string) =>
    crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
      enc.encode(msg),
    );

  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const sig = new Uint8Array(await hmac(secret, dataCheckString));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!safeEqualHex(hex, hash.toLowerCase())) throw new Error("bad signature");

  const user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
  if (!user?.id) throw new Error("initData: no user");
  return user;
}

async function tgApi<T = unknown>(method: string, body: unknown): Promise<T> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result as T;
}

export function sendMessage(chatId: number, text: string): Promise<unknown> {
  return tgApi("sendMessage", { chat_id: chatId, text });
}

export async function downloadTelegramFile(
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const meta = await tgApi<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = meta.file_path ?? "";
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
  if (!res.ok) throw new Error(`file download: ${res.status}`);
  const ext = path.split(".").pop()?.toLowerCase() ?? "ogg";
  const mimes: Record<string, string> = {
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    webm: "audio/webm",
  };
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: mimes[ext] ?? "audio/ogg" };
}
