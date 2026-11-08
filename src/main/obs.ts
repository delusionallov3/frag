import { createHash, randomUUID } from 'crypto'
import { EventEmitter } from 'events'

/**
 * Client minimal pour OBS WebSocket 5 (intégré à OBS depuis la version 28).
 * Dans OBS : Outils → Paramètres du serveur WebSocket → Activer.
 */

const OUTPUTS = 1 << 6 // abonnement aux événements de sortie (enregistrement)

const sha = (s: string): string => createHash('sha256').update(s).digest('base64')

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class ObsError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'unreachable' | 'other' = 'other'
  ) {
    super(message)
  }
}

function closeReason(code: number): ObsError {
  if (code === 4009) return new ObsError('Mot de passe OBS refusé', 'auth')
  if (code === 4010) return new ObsError('Version d’OBS WebSocket trop ancienne (il faut OBS 28 ou plus)')
  if (code === 1006 || code === 1005) {
    return new ObsError('OBS est fermé ou son serveur WebSocket est désactivé', 'unreachable')
  }
  return new ObsError(`Connexion à OBS perdue (code ${code})`, 'unreachable')
}

export class ObsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()
  version: string | null = null

  get ready(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  connect(host: string, port: number, password: string | null): Promise<void> {
    this.close()
    return new Promise((resolve, reject) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json')
      } catch (e) {
        reject(new ObsError(`Adresse OBS invalide (${e instanceof Error ? e.message : e})`))
        return
      }
      const fail = (err: ObsError): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(err)
        try {
          ws.close()
        } catch {
          /* déjà fermé */
        }
      }
      const timeout = setTimeout(() => fail(new ObsError('OBS ne répond pas', 'unreachable')), 5000)

      ws.onmessage = (ev): void => {
        let msg: { op: number; d: Record<string, unknown> }
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        const d = msg.d
        if (msg.op === 0) {
          // Hello : OBS dit s'il faut un mot de passe
          const auth = d.authentication as { challenge: string; salt: string } | undefined
          const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: OUTPUTS }
          if (auth) {
            if (!password) return fail(new ObsError('OBS demande un mot de passe', 'auth'))
            identify.authentication = sha(sha(password + auth.salt) + auth.challenge)
          }
          this.version = typeof d.obsWebSocketVersion === 'string' ? d.obsWebSocketVersion : null
          ws.send(JSON.stringify({ op: 1, d: identify }))
        } else if (msg.op === 2) {
          // Identified
          if (settled) return
          settled = true
          clearTimeout(timeout)
          this.ws = ws
          resolve()
        } else if (msg.op === 5) {
          this.emit('event', d.eventType as string, (d.eventData ?? {}) as Record<string, unknown>)
        } else if (msg.op === 7) {
          const p = this.pending.get(d.requestId as string)
          if (!p) return
          this.pending.delete(d.requestId as string)
          clearTimeout(p.timer)
          const status = d.requestStatus as { result: boolean; code: number; comment?: string }
          if (status?.result) p.resolve(d.responseData ?? {})
          else p.reject(new ObsError(status?.comment || `OBS a refusé la demande (code ${status?.code})`))
        }
      }
      ws.onclose = (ev): void => {
        const err = closeReason(ev.code)
        fail(err)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        if (this.ws === ws) {
          this.ws = null
          this.emit('close', err)
        }
      }
      ws.onerror = (): void => {
        /* onclose suit toujours, avec le code utile */
      }
    })
  }

  request<T = Record<string, unknown>>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new ObsError('OBS n’est pas connecté', 'unreachable'))
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new ObsError(`OBS ne répond pas à ${requestType}`))
      }, 8000)
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }))
    })
  }

  close(): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* rien */
      }
    }
  }
}
