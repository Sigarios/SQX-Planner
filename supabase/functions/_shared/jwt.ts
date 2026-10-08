// Минимальный HS256-подписчик JWT — чтобы не тянуть зависимости.
// Используется для «минтинга» Supabase-совместимого токена после
// проверки Telegram initData (см. functions/auth-verify).

const te = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = b64url(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(te.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, te.encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(sig)}`;
}
