import { promises as fs } from 'fs'
import { request } from 'https'
import { join } from 'path'
import type { GameState } from '@shared/types'

/**
 * Valorant's state, read from the Riot client on this PC (local API, the same one the Discord overlay uses).
 * Nothing leaves the PC: read the client's lockfile, then its presence (menus / agent select / in game).
 */

const LOCKFILE =
  process.env.FRAG_RIOT_LOCKFILE ?? join(process.env.LOCALAPPDATA ?? '', 'Riot Games', 'Riot Client', 'Config', 'lockfile')

interface Lock {
  port: number
  password: string
}

async function readLock(): Promise<Lock | null> {
  try {
    // format: name:pid:port:password:protocol
    const parts = (await fs.readFile(LOCKFILE, 'utf8')).trim().split(':')
    if (parts.length < 5) return null
    const port = Number(parts[2])
    return port ? { port, password: parts[3] } : null
  } catch {
    return null
  }
}

function localGet<T>(lock: Lock, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: lock.port,
        path,
        method: 'GET',
        headers: { Authorization: `Basic ${Buffer.from(`riot:${lock.password}`).toString('base64')}` },
        // the Riot client's self-signed certificate, 127.0.0.1 only
        rejectUnauthorized: false,
        timeout: 3000
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) return reject(new Error(`client Riot : ${res.statusCode}`))
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('Riot client: timed out')))
    req.on('error', reject)
    req.end()
  })
}

interface Presence {
  puuid: string
  product: string
  private?: string
}

export interface GameInfo {
  state: GameState
  /** in-game map path (/Game/Maps/Ascent/Ascent) */
  map: string | null
  queue: string | null
  /** your team's / the enemy team's score during the game */
  score: { ally: number; enemy: number } | null
  /** "Rounds" for round-based modes */
  scoreType: string | null
}

/** Looks for a field at the presence root or in its sub-objects (the format changed several times) */
function pick(priv: Record<string, unknown>, key: string): unknown {
  if (priv[key] !== undefined) return priv[key]
  for (const v of Object.values(priv)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>)[key] !== undefined) {
      return (v as Record<string, unknown>)[key]
    }
  }
  return undefined
}

let myPuuid: { port: number; puuid: string } | null = null

export async function gameInfo(): Promise<GameInfo> {
  const closed: GameInfo = { state: 'closed', map: null, queue: null, score: null, scoreType: null }
  const lock = await readLock()
  if (!lock) return closed
  try {
    if (!myPuuid || myPuuid.port !== lock.port) {
      const session = await localGet<{ puuid?: string }>(lock, '/chat/v1/session')
      if (!session.puuid) return closed
      myPuuid = { port: lock.port, puuid: session.puuid }
    }
    const { presences } = await localGet<{ presences: Presence[] }>(lock, '/chat/v4/presences')
    const me = presences.find((p) => p.puuid === myPuuid!.puuid && p.product === 'valorant')
    if (!me) return closed
    if (!me.private) return { ...closed, state: 'menus' }
    const priv = JSON.parse(Buffer.from(me.private, 'base64').toString('utf8')) as Record<string, unknown>
    // New format (matchPresenceData, partyPresenceData…) or the old flat one: pick() handles both
    const loop = String(pick(priv, 'sessionLoopState') ?? 'MENUS')
    const map = String(pick(priv, 'matchMap') ?? '') || null
    const queue = String(pick(priv, 'queueId') ?? '') || null
    const flow = String(pick(priv, 'provisioningFlow') ?? '')
    const scoreType = (pick(priv, 'gameScoreType') as string | undefined) ?? null
    const ally = Number(pick(priv, 'partyOwnerMatchScoreAllyTeam'))
    const enemy = Number(pick(priv, 'partyOwnerMatchScoreEnemyTeam'))
    const score = Number.isFinite(ally) && Number.isFinite(enemy) ? { ally, enemy } : null
    // The Range isn't a game
    if (/shootingrange/i.test(flow) || /\/Range$/i.test(map ?? '')) return { ...closed, state: 'menus', map, queue }
    const state: GameState = loop === 'INGAME' ? 'ingame' : loop === 'PREGAME' ? 'pregame' : 'menus'
    return { state, map, queue, score: state === 'ingame' ? score : null, scoreType }
  } catch {
    // client starting up or shutting down
    return closed
  }
}
