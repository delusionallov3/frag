import { createHash } from 'crypto'
import { promises as fs, existsSync } from 'fs'
import { extname, join } from 'path'
import type { AgentAsset, MapAsset, TierAsset, ValAssets, WeaponAsset } from '@shared/types'
import { paths, readJson, writeJson } from './store'

/** Free public API (no key): https://valorant-api.com */
const BASE = process.env['FRAG_VALAPI_BASE'] || 'https://valorant-api.com'
const MEDIA_HOSTS = new Set(['media.valorant-api.com', ...(process.env['FRAG_VALAPI_BASE'] ? [new URL(BASE).host] : [])])
const TTL = 7 * 24 * 3600 * 1000

const assetsFile = (): string => join(paths.cache, 'valorant-api.json')
const imagesDir = (): string => join(paths.cache, 'valorant-images')

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`valorant-api.com ${res.status}`)
  const json = (await res.json()) as { data: T }
  return json.data
}

interface RawAgent {
  uuid: string
  displayName: string
  isPlayableCharacter?: boolean
  role?: { displayName?: string } | null
  displayIcon?: string | null
  displayIconSmall?: string | null
  killfeedPortrait?: string | null
  fullPortrait?: string | null
  bustPortrait?: string | null
  backgroundGradientColors?: string[] | null
}
interface RawMap {
  uuid: string
  displayName: string
  mapUrl?: string | null
  splash?: string | null
  listViewIcon?: string | null
  listViewIconTall?: string | null
}
interface RawWeapon {
  uuid: string
  displayName: string
  killStreamIcon?: string | null
  displayIcon?: string | null
}
interface RawTiers {
  uuid: string
  tiers: {
    tier: number
    tierName: string
    smallIcon?: string | null
    largeIcon?: string | null
    color?: string | null
  }[]
}

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const hex = (c?: string | null): string | null => (c && /^[0-9a-f]{6,8}$/i.test(c) ? `#${c.slice(0, 6)}` : null)

interface RawIconItem {
  displayName?: string | null
  displayIcon?: string | null
  killStreamIcon?: string | null
}

/** No dedicated spike endpoint: look for the "Spike" gear, else the Spike Rush mode icon */
async function findSpike(): Promise<string | null> {
  const isSpike = (n?: string | null): boolean => /spike/i.test(n ?? '') && !/rush/i.test(n ?? '')
  try {
    const eq = await get<RawIconItem[]>('/v1/gamemodes/equippables')
    const hit = eq.find((e) => isSpike(e.displayName))
    if (hit) return hit.killStreamIcon ?? hit.displayIcon ?? null
  } catch {
    /* endpoint missing */
  }
  try {
    const modes = await get<RawIconItem[]>('/v1/gamemodes')
    const rush = modes.find((m) => /spike\s*rush/i.test(m.displayName ?? ''))
    return rush?.displayIcon ?? null
  } catch {
    return null
  }
}

async function download(): Promise<ValAssets> {
  const [agents, maps, weapons, tiers, spike] = await Promise.all([
    get<RawAgent[]>('/v1/agents?isPlayableCharacter=true'),
    get<RawMap[]>('/v1/maps'),
    get<RawWeapon[]>('/v1/weapons'),
    get<RawTiers[]>('/v1/competitivetiers'),
    findSpike()
  ])
  const lastTiers = tiers[tiers.length - 1]?.tiers ?? []
  return {
    agents: agents
      .filter((a) => a.isPlayableCharacter !== false)
      .map<AgentAsset>((a) => ({
        uuid: a.uuid,
        name: a.displayName,
        role: a.role?.displayName ?? null,
        icon: a.displayIcon ?? a.displayIconSmall ?? null,
        killfeed: a.killfeedPortrait ?? a.displayIconSmall ?? null,
        portrait: a.fullPortrait ?? a.bustPortrait ?? null,
        colors: (a.backgroundGradientColors ?? []).map(hex).filter((c): c is string => !!c)
      })),
    maps: maps.map<MapAsset>((m) => ({
      uuid: m.uuid,
      name: m.displayName,
      path: m.mapUrl ?? null,
      splash: m.splash ?? null,
      listView: m.listViewIcon ?? m.listViewIconTall ?? null
    })),
    weapons: weapons.map<WeaponAsset>((w) => ({
      uuid: w.uuid,
      name: w.displayName,
      killfeed: w.killStreamIcon ?? null,
      icon: w.displayIcon ?? null
    })),
    tiers: lastTiers
      .filter((t) => t.tier > 2)
      .map<TierAsset>((t) => ({
        tier: t.tier,
        name: titleCase(t.tierName),
        icon: t.largeIcon ?? t.smallIcon ?? null,
        color: hex(t.color)
      })),
    spike,
    fetchedAt: Date.now()
  }
}

let memo: ValAssets | null = null
let lastError: string | null = null

export const assetsError = (): string | null => lastError
let pending: Promise<ValAssets | null> | null = null

/** Assets cached on disk (7 days); if the site is unreachable, keep the old cache */
export function getAssets(force = false): Promise<ValAssets | null> {
  if (memo && !force && Date.now() - memo.fetchedAt < TTL) return Promise.resolve(memo)
  if (pending) return pending
  pending = (async () => {
    const cached = await readJson<ValAssets>(assetsFile())
    if (cached && !force && Date.now() - cached.fetchedAt < TTL && 'spike' in cached && cached.maps.every((m) => 'path' in m)) {
      memo = cached
      return cached
    }
    try {
      const fresh = await download()
      lastError = null
      await writeJson(assetsFile(), fresh)
      memo = fresh
      return fresh
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      memo = cached
      return cached
    }
  })().finally(() => {
    pending = null
  })
  return pending
}

/* ------------------------------------------------------------------ Locally cached images */

const IMG_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/** Downloads (once) an image from media.valorant-api.com and returns the local file */
export async function cachedImage(url: string): Promise<{ file: string; type: string } | null> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!MEDIA_HOSTS.has(u.host)) return null
  const ext = extname(u.pathname).toLowerCase() || '.png'
  const type = IMG_TYPES[ext] ?? 'image/png'
  const file = join(imagesDir(), createHash('sha1').update(url).digest('hex') + ext)
  if (existsSync(file)) return { file, type }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    await fs.mkdir(imagesDir(), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()))
    await fs.rename(tmp, file)
    return { file, type }
  } catch {
    return null
  }
}
