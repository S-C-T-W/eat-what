/**
 * eat-what-push — tiny Cloudflare Worker that delivers the lunch/dinner
 * nudges. It stores push subscriptions + schedules in KV and sends VAPID
 * web push on a 15-minute cron, in each subscriber's own timezone.
 *
 * Privacy contract: this worker never sees Google/AI keys, locations, or
 * draw history — only a push endpoint and the notification schedule.
 */
import { buildPushPayload } from '@block65/webcrypto-web-push'

import { mealCopy, testCopy, type NotificationCopy, SUPPORTED_LOCALES } from './copy'
import { isRoomId, newRoomId } from './rooms'
import { dueMeals, localParts, parseTime, type MealPref, type MealPrefs } from './schedule'
import type { CronHealth, Env, StoredSubscription } from './types'

// The Durable Object class must be exported from the worker entry module
export { RoomDO } from './rooms'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const MAX_BODY_BYTES = 8192

/** Delete a subscription only after this many consecutive gone responses */
const PRUNE_STRIKES = 2

/** Subscription keys are SHA-256 hex — '_' prefix is reserved for metadata */
const META_KEY = '_meta:health'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

/** Endpoint URLs can exceed KV's key length limit — hash them. */
async function kvKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isMealPref(v: unknown): v is MealPref {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return (
    typeof m.enabled === 'boolean' &&
    typeof m.time === 'string' &&
    parseTime(m.time) !== null &&
    Array.isArray(m.days) &&
    m.days.length <= 7 &&
    m.days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
  )
}

function isPrefs(v: unknown): v is MealPrefs {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isMealPref(p.lunch) && isMealPref(p.dinner)
}

/** Validate and normalize the wire subscription into the stored shape. */
function parseSubscription(v: unknown): StoredSubscription['subscription'] | null {
  if (typeof v !== 'object' || v === null) return null
  const s = v as Record<string, unknown>
  const keys = s.keys as Record<string, unknown> | undefined
  if (
    typeof s.endpoint !== 'string' ||
    !s.endpoint.startsWith('https://') ||
    s.endpoint.length >= 1024 ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string'
  ) {
    return null
  }
  return {
    endpoint: s.endpoint,
    expirationTime: typeof s.expirationTime === 'number' ? s.expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

type SendResult = { kind: 'ok' | 'gone' | 'error'; status: number }

async function sendPush(
  env: Env,
  stored: StoredSubscription,
  copy: NotificationCopy,
  extra: { url: string; tag: string },
): Promise<SendResult> {
  try {
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({
          title: copy.title,
          body: copy.body,
          url: extra.url,
          tag: extra.tag,
          lang: stored.locale,
        }),
        // No Topic header: Apple requires the value to be DECODABLE base64url
        // (not just base64url charset per RFC 8030), so any length ≡ 1 mod 4
        // gets 400 {"reason":"BadWebPushTopic"} — 'lunch' (5 chars) failed,
        // 'test'/'dinner' passed. If collapse behavior is ever wanted again,
        // base64url-encode the topic first. The 30-min TTL already bounds
        // duplicate pileup, so we simply omit it.
        options: { ttl: 1800, urgency: 'normal' },
      },
      stored.subscription,
      {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    )
    const res = await fetch(stored.subscription.endpoint, payload)
    if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status }
    if (!res.ok) {
      // Push services put the rejection reason in the body — log it, this
      // is the difference between a 5-minute fix and a blind hunt
      console.log('push rejected', res.status, (await res.text()).slice(0, 160))
    }
    return { kind: res.ok ? 'ok' : 'error', status: res.status }
  } catch (err) {
    console.log('sendPush threw', String(err))
    return { kind: 'error', status: 0 }
  }
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  if (!body) return json({ error: 'bad request' }, 400)

  const { subscription: rawSubscription, tz, locale, prefs } = body
  const subscription = parseSubscription(rawSubscription)
  if (!subscription) return json({ error: 'invalid subscription' }, 400)
  if (typeof tz !== 'string' || !localParts(new Date(), tz)) {
    return json({ error: 'invalid timezone' }, 400)
  }
  if (!isPrefs(prefs)) return json({ error: 'invalid prefs' }, 400)

  const key = await kvKey(subscription.endpoint)
  const existing = await env.SUBS.get<StoredSubscription>(key, 'json')
  const record: StoredSubscription = {
    subscription,
    tz,
    locale: typeof locale === 'string' && SUPPORTED_LOCALES.has(locale) ? locale : 'en',
    prefs,
    // A prefs update must not re-fire a meal already sent today
    lastSent: existing?.lastSent,
    // A fresh sync from a live client clears any pending prune strikes
    strikes: 0,
    updatedAt: new Date().toISOString(),
  }
  await env.SUBS.put(key, JSON.stringify(record))
  console.log(existing ? 'subscribe: updated' : 'subscribe: new', key.slice(0, 8))
  return json({ ok: true })
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400)
  const key = await kvKey(endpoint)
  await env.SUBS.delete(key)
  console.log('unsubscribe', key.slice(0, 8))
  return json({ ok: true })
}

async function handleTest(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400)
  const key = await kvKey(endpoint)
  const stored = await env.SUBS.get<StoredSubscription>(key, 'json')
  if (!stored) return json({ error: 'not subscribed' }, 404)
  const result = await sendPush(env, stored, testCopy(stored.locale), {
    url: '/',
    tag: 'eat-what-test',
  })
  console.log('test push', key.slice(0, 8), result.kind, result.status)
  if (result.kind === 'gone') {
    // Report it, but let the client heal by re-subscribing — don't hard-delete
    return json({ error: 'subscription expired' }, 410)
  }
  return result.kind === 'ok' ? json({ ok: true }) : json({ error: 'push failed' }, 502)
}

async function handleHealth(env: Env): Promise<Response> {
  const health = await env.SUBS.get<CronHealth>(META_KEY, 'json')
  return json({ ok: true, lastCron: health })
}

async function deliverDue(env: Env, now: Date): Promise<void> {
  const health: CronHealth = {
    at: now.toISOString(),
    scanned: 0,
    due: 0,
    sent: 0,
    errors: 0,
    pruned: 0,
  }
  let cursor: string | undefined
  do {
    const page = await env.SUBS.list({ cursor })
    for (const { name: key } of page.keys) {
      // Subscription keys are SHA-256 hex; skip metadata and room:* entries
      if (!/^[0-9a-f]{64}$/.test(key)) continue
      const stored = await env.SUBS.get<StoredSubscription>(key, 'json')
      if (!stored) continue
      health.scanned++

      const due = dueMeals(stored.prefs, stored.lastSent ?? {}, now, stored.tz)
      if (!due.length) continue
      health.due += due.length

      let gone = false
      for (const { meal, date } of due) {
        const result = await sendPush(env, stored, mealCopy(meal, stored.locale), {
          url: '/?draw=1',
          tag: `eat-what-${meal}`,
        })
        console.log('meal push', key.slice(0, 8), meal, result.kind, result.status)
        if (result.kind === 'gone') {
          gone = true
          break
        }
        if (result.kind === 'ok') {
          health.sent++
          stored.lastSent = { ...stored.lastSent, [meal]: date }
          stored.strikes = 0
        } else {
          health.errors++
        }
      }

      if (gone) {
        // Prune only after consecutive gone responses — a subscription that
        // just hiccuped gets another chance next tick (dedup via lastSent)
        stored.strikes = (stored.strikes ?? 0) + 1
        if (stored.strikes >= PRUNE_STRIKES) {
          await env.SUBS.delete(key)
          health.pruned++
          console.log('pruned dead subscription', key.slice(0, 8))
          continue
        }
      }
      await env.SUBS.put(key, JSON.stringify(stored))
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  await env.SUBS.put(META_KEY, JSON.stringify(health))
  console.log('cron done', JSON.stringify(health))
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ service: 'eat-what-push', ok: true })
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealth(env)
    }
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      return handleSubscribe(request, env)
    }
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      return handleUnsubscribe(request, env)
    }
    if (url.pathname === '/test' && request.method === 'POST') {
      return handleTest(request, env)
    }

    // Group-draw rooms — proxied to one Durable Object per room id; the DO
    // gives read-your-writes consistency that KV's 60 s edge cache cannot
    if (url.pathname === '/room' && request.method === 'POST') {
      const bodyText = await request.text()
      // Larger cap than other routes: candidates carry restaurant snapshots
      if (!bodyText || bodyText.length > 32_768) return json({ error: 'bad request' }, 400)
      const roomId = newRoomId()
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId))
      const res = await stub.fetch('https://room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText,
      })
      const payload = (await res.json()) as Record<string, unknown>
      return res.ok ? json({ roomId, ...payload }) : json(payload, res.status)
    }
    const roomMatch = /^\/room\/([A-Za-z0-9]{6})(\/(veto|result))?$/.exec(url.pathname)
    if (roomMatch && isRoomId(roomMatch[1]!)) {
      const id = roomMatch[1]!.toUpperCase()
      const action = roomMatch[3]
      const stub = env.ROOMS.get(env.ROOMS.idFromName(id))
      if (!action && request.method === 'GET') {
        const res = await stub.fetch('https://room/')
        return json(await res.json(), res.status)
      }
      if (action && request.method === 'POST') {
        const bodyText = await request.text()
        if (!bodyText || bodyText.length > MAX_BODY_BYTES) {
          return json({ error: 'bad request' }, 400)
        }
        const res = await stub.fetch(`https://room/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyText,
        })
        return json(await res.json(), res.status)
      }
    }

    return json({ error: 'not found' }, 404)
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(deliverDue(env, new Date()))
  },
} satisfies ExportedHandler<Env>
