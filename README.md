# EatWhat 食乜好 🍜🎡

> 「今晚食乜好？」 — the one question that defeats every Hongkonger, every single day.

**English · [繁體中文](README.zh-TW.md)** · **Live app: [eat-what.samsonchoi.hk](https://eat-what.samsonchoi.hk)**

## The story

Somebody asks "so… where are we eating?" and forty minutes later everyone is still saying 「求其啦」 and nobody has moved. EatWhat ends that conversation with a spinning wheel: tell it what you care about tonight — cuisine, budget, distance, who's coming — and let fate handle the part humans are bad at. The wheel is theatre (the winner is drawn fairly with `crypto.getRandomValues` before it ever spins), but it turns out theatre is exactly what a deadlocked table needs.

It grew from a weekend toy into a small opinionated product: group veto rooms for deciding with friends, a food diary that learns what *you* think of places (and quietly outranks Google when you disagree), planned draws for next Monday's dinner, and meal-time push reminders. It's a PWA — install it from the browser and it behaves like a native app.

Three principles shaped everything:

1. **Your data never leaves your device.** History, diary, blocklist, settings — all in IndexedDB/localStorage. There is no account, no analytics, no tracking.
2. **Bring your own key, pay nothing.** The app talks straight from your browser to Google Places using *your* API key, engineered (caching + quota caps) so a personal key stays inside Google's free monthly tiers. Nobody's credit card sits behind a shared server.
3. **A backend only where physics demands it.** Exactly two features can't be pure-frontend — scheduled push and shared group rooms — so one tiny Cloudflare Worker (~40 KB) handles both, storing only push endpoints and 1-hour-lifetime room states. Never keys, never history, never location.

## The tour

### 🎡 Draw
Tap **DRAW**. Up to 10 matching restaurants land on the wheel, one wins, confetti flies. Not feeling it? **Re-spin** excludes the loser and picks again from the same pool — no extra API calls — and if you've edited your filters in between, it detects that and re-queries properly. Three draw styles: **Fair** (every match equal), **Favourites** (places you accept often — and rate highly — win more), **Explore** (never-tried places boosted).

### 🎛️ Conditions
Everything supports "surprise me":

- **Cuisines** — tri-state chips: neutral → include → exclude (exclusion always wins)
- **Cravings** — 38 OpenRice-style fine tags Google's type system can't express (茶餐廳, 兩餸飯, 打邊爐, omakase, 放題…), searched the way a local would type them, up to 3 per draw
- **Budget** — a per-person **money range slider** in your local currency (`< HK$50` … `HK$1,000+`, exact amount when the thumbs meet), filtered by window overlap against Google's price data — plus an opt-in "only places with price data" switch
- **Distance** — free slider 100 m – 5 km; the exact value filters client-side while API queries snap up to shared cache steps so slider-fiddling never burns quota
- **When** — "open now", or an arrival time **on any future date**: hours are checked for that weekday and the result is saved as an upcoming plan
- **From where** — GPS or any searched location (planning near your office? a friend's neighbourhood?)
- Minimum rating, "don't repeat the last N days", party size — and any combination saved as a named **preset** (「公司午餐」, 「拍拖晚餐」…) for one-tap reuse
- Zero matches? One-tap **relaxation chips** show exactly which constraint to drop and how many places come back

### 🗺️ Where to search
The circle around you is only the default. **Shift** it (300 m east, from your location or from any searched base), narrow it to a **90° / 180° wedge** in one direction, union up to **5 spots**, or search a **corridor** along an A→B line (its own width slider, up to 8 km apart). A coverage planner turns any shape into ≤ 3 Google calls, everything is re-checked client-side against the exact geometry, and a live **map preview** (MapLibre + OpenFreeMap vector tiles, keyless) projects the area you are about to search — with a blue "you are here" dot grabbed when the filter opens. Advanced modes hide behind a ⚙️ so the everyday filter stays short.

### 🗣️ Say it instead
With an (optional, BYO) OpenAI-compatible AI configured: hold the mic and say 「下星期一晚七點，唔好辣，每人一百蚊以內」 — speech becomes structured filters through a strict JSON contract, and every value is re-validated against closed vocabularies so a hallucination can never corrupt your settings. Type a mood instead and the **AI concierge** picks the winner from the wheel with a one-line reason (labelled 🤖, so you always know when it wasn't chance). A keyless weather chip (Open-Meteo) suggests rainy-day/hot-day presets.

### 👥 Decide together
Group draw rooms: share a link, a **QR code**, or a 6-character room code (friends join in-app via camera scan or manual entry — the path that works even where OS link-handling doesn't). Everyone gets **one veto**; the host makes the final draw; anyone can save the winner to their own history, badged 👥. Rooms hold a slim data snapshot so joiners need zero setup, live on a strongly-consistent Durable Object (veto sync in ~2 s), and self-destruct after an hour.

### 📔 Your food diary
History is grouped by day and meal slot — 🍳 早餐 / 🥪 午餐 / ☕️ 下午茶 / 🌙 晚餐 / 🌜 宵夜 — with 📅 **Upcoming plans** pinned on top until their time comes, stats (streaks, distinct places, top cuisines), and iOS-style swipe-to-delete. Every record opens a diary: what you ate, what you actually paid per person, corrected cuisines, craving tags — and a **verdict rating** that future draws treat as truer than Google:

| Your star | Meaning | Effect in the ★ filter |
|---|---|---|
| ⭐5 至愛 | love it | passes every filter, even ★4.5+ |
| ⭐4 好食 | good | counts as at least 4.0 (Google can only raise it) |
| ⭐3 一般 | okay | abstains — Google's rating decides |
| ⭐2 麻麻 | meh | hidden whenever a rating filter is on |
| ⭐1 唔會再嚟 | never again | ditto, emphatically |

Why a table instead of raw numbers? Google's stars are a crowd average squeezed into ~3.5–4.5; your star is a personal verdict on a full 1–5 spread. Treating them as the same axis would make "okay" a death sentence. The diary also hosts the **blocklist** toggle and a **permanently closed** report (also one tap on the result card) — closed places vanish from every future draw, even while Google still lists them.

### 🍽️ The result card
Photo, rating (Google's and yours), price in local currency, distance, today's hours, address — plus one-tap **Google Maps** directions, **OpenRice** (HK/MO), **Tabelog** (Japan), share as link or as a rendered **image card**.

### 🔔 Meal reminders
Opt-in lunch/dinner push, per-meal times and weekdays, in your device's timezone (a 5-minute Worker cron checks each subscription in *its* local time). Tapping a notification opens the app and spins immediately. iOS requires installing to the Home Screen first — Apple only grants push to installed PWAs.

### 🧪 Demo mode
No key yet? Everything above runs on built-in sample data, clearly bannered.

## Built like an app

Installable PWA (offline shell, auto-updating service worker), iOS-style liquid-glass tab bar, no input-zoom or text-selection jank, swipe gestures, full dark mode, and **four UI languages** — English, 廣東話 (zh-HK), 台灣繁體中文 (zh-TW), 日本語 (ja). Chinese is matched by *region*, not script, so Hong Kong users get Cantonese and Taiwan users get written Mandarin, each with its own app name (食乜好 · 呷什麼 · なに食べる？); key sets and placeholders are kept in parity by a test.

## The $0 architecture

```
┌─ Your device ──────────────────────────────┐      ┌─ Google ─────────────┐
│ Vue 3 SPA (Vite, Tailwind, Pinia)          │──────▶ Places API (New)     │
│ · your keys in localStorage                │      │ billed to YOUR key,  │
│ · history/diary/cache in IndexedDB (Dexie) │      │ capped at $0         │
│ · service worker: offline + push display   │      └──────────────────────┘
└──────────────┬─────────────────────────────┘
               │ only: push subscription + room snapshots
┌──────────────▼─────────────────────────────┐
│ Cloudflare Worker (free tier)              │
│ · cron */5: timezone-aware meal reminders  │
│ · rooms as Durable Objects (1 h lifetime)  │
└────────────────────────────────────────────┘
```

Every Google call is defended twice: a 24-hour IndexedDB cache keyed by ~110 m geo-cell + filters (re-spins never re-query; keyword tags cache per-tag; radius quantization keeps slider values sharing entries), and **hard daily quota caps** you set on your own key — the actual $0 guarantee, since referrer restrictions can be forged but quotas cannot.

| What | SKU tier | Free/month | How the app protects it |
|---|---|---|---|
| Restaurant search (rating/price/hours) | Enterprise | 1,000 | 24 h cache; re-spins reuse the pool |
| Fine-tag text search | Enterprise | (same pool) | one per tag per draw, cached 24 h per tag |
| Place photos | Enterprise | 1,000 | exactly one, winner only, ≤800 px, SW-cached 7 days |
| Location autocomplete | Essentials | 10,000 | 2 s debounce, session tokens |
| Key validation | Essentials (IDs-only) | unlimited | free by design |

## Set up your own key (users)

Follow the in-app first-run checklist. Summary:

1. Create a Google Cloud project and enable **Places API (New)** (billing attached — personal usage stays inside the free monthly quota)
2. Create an API key; restrict it to this app's origin and to Places API (New) only
3. **Set daily quota caps** — the hard guarantee your card is never charged (below)
4. Paste the key in the app → Validate (a free call). The key never leaves your device.

### Step 3 in detail: daily quota caps

> **Prerequisite:** Google only lets you edit quotas after upgrading from "Free Trial" to pay-as-you-go (blue **Upgrade** button in the console). You keep every monthly free allowance — and with these caps the bill physically cannot leave $0.

Console → **Google Maps Platform → Quotas** → dropdown **Places API (New)** → per request type: tick → **Edit Quota** → value → **Submit**.

| Request type | Daily cap |
|---|---|
| `SearchNearbyRequest` | **30** |
| `GetPhotoMediaRequest` | **30** |
| `GetPlaceRequest` | **30** |
| `SearchTextRequest` | **30** |
| `AutocompletePlacesRequest` | **300** |

Optional per-minute brakes: SearchNearby 3 · Photo 10 · GetPlace 4 · SearchText 3 · Autocomplete 50. The caps are sized so even a leaked key billing at the priciest tier for a full month stays inside the 1,000-call free tier.

## Fork & deploy your own

```bash
pnpm install && pnpm build          # fully static, zero env vars
pnpm dlx wrangler@4.80.0 login
pnpm dlx wrangler@4.80.0 pages project create eat-what --production-branch main   # once
pnpm run deploy
```

> Wrangler is pinned to 4.80.0 because newer versions need Node ≥ 22. Or skip the CLI: connect the repo in the Cloudflare Pages dashboard (build `pnpm build`, output `dist`). Any static host works.

**Push + rooms worker** (optional — the app works fully without it; notifications and group rooms are the only features that need it):

```bash
pnpm run worker:keys                                   # prints a VAPID key pair
pnpm dlx wrangler@4.80.0 kv namespace create SUBS      # note the id
# edit worker/wrangler.jsonc: kv id + VAPID_PUBLIC_KEY + your VAPID_SUBJECT
# edit src/lib/push/config.ts: your worker URL + the same public key
pnpm run worker:deploy
pnpm dlx wrangler@4.80.0 secret put VAPID_PRIVATE_KEY -c worker/wrangler.jsonc
```

## Development

```bash
pnpm dev        # Vite dev server
pnpm test       # Vitest (unit tests cover the draw engine, filters, caching, tz scheduling…)
pnpm typecheck  # vue-tsc, strict + noUncheckedIndexedAccess
pnpm lint
```

Node ≥ 20.19, pnpm. Stack: Vue 3.5 · Vite · TypeScript strict · Tailwind v4 · Pinia (+persistedstate) · Dexie · vue-i18n · vite-plugin-pwa (injectManifest, custom SW) · Cloudflare Workers + Durable Objects.

## Milestones

Built July 2026, shipped in public from day one:

- **M0–M4 · v1** — scaffold → wheel + conditions + relaxations on mock data → BYO-key onboarding with live Places + quota engineering → history/blocklist/PWA polish → AI concierge + share + OSS docs
- **Phase 2 · notifications** — Worker cron + KV + VAPID push, per-meal schedules, timezone-aware; hardened after a real-world hunt that ended at Apple's `BadWebPushTopic` (Topic headers must be *decodable* base64url — 5-char topics silently kill lunch pushes 🙃)
- **M6 · the fun batch** — fine-grained craving tags, group veto rooms, weighted draw styles, history stats, image share cards, weather chip
- **Refit rounds** — rooms moved KV → Durable Objects (read-your-writes veto sync), arrival-time + future-date planning with 📅 Upcoming, iOS-26-style tab bar, AI voice → filters, condition presets, money-window budget + distance sliders, food diary with verdict stars / spend / corrections / closed reports, QR + room-code joining, five meal slots (早餐 → 宵夜)
- **Aug–Sep 2026 rounds** — search geometry (shift / wedge / multi-spot / corridor with a ≤ 3-call coverage planner), live map preview, per-visit food diary with averaged verdicts, chain & fast-food filters, four UI languages

## Privacy & security

- Keys live in `localStorage`, requests go browser → Google / your AI endpoint directly; the Worker never sees them
- Strict CSP (`script-src 'self'`), zero third-party scripts, no analytics
- Referrer + API restriction + your quota cap = the containment story for a client-side key
- Honest caveat: anyone with your unlocked device can read localStorage — same trust level as your logged-in apps
- The map preview fetches vector tiles from [OpenFreeMap](https://openfreemap.org) (`tiles.openfreemap.org`) — the only third-party connection in the app. It learns the rough area you are looking at (tile coordinates), never your keys, history or a precise fix; no cookies, no account. Self-hosting PMTiles on R2 is the documented escape hatch.

## Credits

Designed and product-directed by [Samson Choi](https://github.com/choi12191995) in Hong Kong. Pair-programmed with Claude (Anthropic) — the commit history is the transcript. Restaurant data © Google; weather by Open-Meteo.

## License

[MIT](LICENSE) — fork it, deploy it, feed your friends.
