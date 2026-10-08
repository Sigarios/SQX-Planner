# tg-planner — личный планер для Telegram

Mini App + бот для личного учёта задач, заметок и встреч. Без платежей, подписок,
лимитов и рекламы. Всё работает на бесплатных тарифах Supabase и Vercel.

**Важно про токен бота:** если токен где-то засветился (например, был отправлен в чат) —
отзови его: @BotFather → `/mybots` → бот → API Token → **Revoke current token**.
Новый токен нигде не хранится в коде, он идёт только в секреты Supabase.

## Структура

```
tg-planner/
├── supabase/
│   ├── config.toml                  # verify_jwt=false для всех функций (проверка своя)
│   ├── migrations/0001_init.sql     # таблицы, RLS, realtime
│   └── functions/
│       ├── _shared/                 # http, jwt, telegram initData, AI, запись в БД
│       ├── auth-verify/             # initData → JWT для Supabase
│       ├── telegram-webhook/        # голосовые/тексты из чата бота
│       └── capture-ingest/          # приёмник для iPhone Shortcuts
└── src/
    ├── app/                         # Digest (/), календарь (/calendar), заметки (/notes)
    ├── components/                  # BottomNav, TaskItem, QuickAdd
    └── lib/                         # сессия, данные, telegram SDK, типы
```

## 1. Supabase

1. Создай проект на [supabase.com](https://supabase.com) (free tier).
2. SQL Editor → вставь содержимое `supabase/migrations/0001_init.sql` → Run.
   (Или через CLI: `supabase link --project-ref <ref>` и `supabase db push`.)
3. Settings → API: сохрани `Project URL`, `anon`-ключ (или `sb_publishable_...`)
   и **JWT Secret (legacy)**. Если у проекта включены новые signing keys — убедись,
   что legacy JWT secret активен (Settings → API → JWT Settings), иначе minted-токены
   не будут проходить проверку.
4. Установи Supabase CLI, затем из папки `tg-planner/`:

```bash
supabase login
supabase link --project-ref <project-ref>
```

5. Сгенерируй значения секретов **заранее и сохрани их** (CLI не показывает их повторно):

```bash
openssl rand -hex 24   # → TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 24   # → CAPTURE_SECRET
```

6. Задай секреты:

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<новый_токен_от_BotFather> \
  TELEGRAM_WEBHOOK_SECRET=<сгенерированный> \
  OPENROUTER_API_KEY=<sk-or-vn-...> \
  OPENROUTER_MODEL=openai/gpt-4o-mini \
  GROQ_API_KEY=<gsk_...> \
  CAPTURE_SECRET=<сгенерированный> \
  CAPTURE_USER_ID=<твой_telegram_id> \
  APP_TZ=Europe/Moscow \
  ALLOW_DEV_AUTH=false
```

- `OPENROUTER_MODEL` — любая дешёвая модель; для экономии можно `google/gemini-2.0-flash-001`
  или бесплатные варианты вида `meta-llama/llama-3.3-70b-instruct:free`.
- `GROQ_API_KEY` — [console.groq.com](https://console.groq.com), бесплатный тариф.
  OpenRouter аудио не принимает, поэтому расшифровка речи идёт через Groq Whisper.
- `CAPTURE_USER_ID` — твой Telegram ID (узнать: написать боту любое сообщение и
  посмотреть логи `supabase functions logs telegram-webhook`, либо @userinfobot).

7. Задеплой функции (config.toml уже отключает проверку Supabase-JWT):

```bash
supabase functions deploy
```

## 2. Фронтенд

```bash
cp .env.local.example .env.local   # и заполни значения
npm install
npm run dev                        # http://localhost:3000
```

Для локальной разработки в браузере (вне Telegram): раскомментируй
`NEXT_PUBLIC_DEV_TG_ID` в `.env.local` и поставь `ALLOW_DEV_AUTH=true` в секретах
Supabase. **Перед деплоем верни `ALLOW_DEV_AUTH=false`.**

### Vercel

Импортируй репозиторий в Vercel, Root Directory = `tg-planner`, добавь те же
`NEXT_PUBLIC_*` переменные. Фреймворк определится сам (Next.js).

## 3. Telegram BotFather

1. `/setmenubutton` → выбери бота → отправь URL приложения
   (`https://<твой-проект>.vercel.app`) → отправь текст кнопки, например «Открыть».
   Слева от поля ввода в чате появится кнопка, открывающая Mini App.
2. (Опционально) `/newapp` — задаёт иконку/описание и даёт прямую ссылку `t.me/<bot>/app`.
3. Подключи вебхук (секрет должен совпадать с `TELEGRAM_WEBHOOK_SECRET`):

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message"]'
```

Проверка: пришли боту голосовое «Встреча с налоговой завтра в два» — он ответит итогом,
а запись появится в приложении мгновенно (realtime).

## 4. iPhone: Shortcut + Action Button

Ограничение iOS: Action Button срабатывает одним нажатием, «запись, пока держишь
кнопку», система не даёт. Останов настраивается внутри ярлыка (после паузы или по тапу).

### Вариант А — диктовка (рекомендую: быстрее и точнее)

1. Быстрые команды → «+».
2. «Добавить действие» → **«Продиктовать текст»** (Dictate Text).
   В настройках действия: Язык — Русский, Остановить — «После паузы».
3. «+» → **«Получить содержимое URL»** (Get Contents of URL):
   - URL: `https://<project-ref>.supabase.co/functions/v1/capture-ingest`
   - Развернуть → Показать больше → Метод: **POST**
   - Заголовки: добавить `Authorization` : `Bearer <CAPTURE_SECRET>`
   - Тело запроса → **Форма**:
     - поле `text` = «Продиктованный текст» (переменная из шага 2)
     - поле `source` = `shortcut`
4. «+» → **«Показать уведомление»** → текст = переменная «Содержимое URL»
   (там будет итог: «Задача „…“ — на …»).
5. Назови ярлык, например «Мысль в планер».
6. Настройки iPhone → **Кнопка действия** → Ярлык → «Мысль в планер».

Диктовка работает и с экрана блокировки. Записал мысль → пауза → ярлык сам отправляет
текст и показывает уведомление с тем, что сохранилось.

### Вариант Б — аудиозапись

Если в твоей версии iOS есть действие **«Запись аудио»** (Record Audio): добавь его
вместо диктовки (старт — немедленно, останов — по тишине или по тапу), а в
«Получить содержимое URL» в теле формы задай поле `file` = запись. Остальные шаги
те же: аудио уйдёт на `capture-ingest`, расшифруется через Whisper и разберётся.
Если такого действия в iOS нет — используй вариант А.

### Проверка без телефона

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/capture-ingest" \
  -H "Authorization: Bearer <CAPTURE_SECRET>" \
  -F "text=Позвонить маме завтра"
```

Ожидаемый ответ: `Задача «Позвонить маме» — на <завтрашняя дата>`.

## 5. Безопасность

- RLS включён на всех таблицах: строка доступна только при совпадении
  `user_id` с `tg_id` из проверенного JWT (подпись initData → токен).
- Edge Functions с записью в БД работают от service role, но user_id берут
  из проверенного источника: подпись initData, секрет вебхука, `CAPTURE_SECRET`.
- `ALLOW_DEV_AUTH=true` — только локально. В проде всегда `false`.
