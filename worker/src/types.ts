import type { Meal, MealPrefs } from './schedule'

/** Wire + KV shape. The worker stores ONLY this — never any user API key. */
export interface StoredSubscription {
  subscription: {
    endpoint: string
    expirationTime: number | null
    keys: { p256dh: string; auth: string }
  }
  /** IANA timezone from the subscriber's device */
  tz: string
  /** 'en' | 'zh-HK' | 'zh-TW' | 'ja' — which copy to send (see copy.ts) */
  locale: string
  prefs: MealPrefs
  /** Local date (YYYY-MM-DD) of the last send, per meal — dedup across cron runs */
  lastSent?: Partial<Record<Meal, string>>
  /** Consecutive 404/410 responses — pruned only after PRUNE_STRIKES in a row,
   * so one transient push-service hiccup can't kill a live subscription */
  strikes?: number
  updatedAt?: string
}

/** Written under META_KEY on every cron run — surfaced by GET /health */
export interface CronHealth {
  at: string
  scanned: number
  due: number
  sent: number
  errors: number
  pruned: number
}

export interface Env {
  SUBS: KVNamespace
  /** Group-draw rooms — one strongly-consistent Durable Object per room */
  ROOMS: DurableObjectNamespace
  VAPID_PUBLIC_KEY: string
  VAPID_SUBJECT: string
  /** Worker secret — set via `wrangler secret put VAPID_PRIVATE_KEY` */
  VAPID_PRIVATE_KEY: string
}
