import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play,
  Pause,
  StepBack,
  StepForward,
  Repeat,
  Volume2,
  VolumeX,
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Flag,
  Undo2,
  Redo2,
  Loader2,
  AlertTriangle
} from '../lib/icons'
import type { AutoSyncResult, Clip, MatchData, MatchLink, Marker, ReviewNote, RiotAccount, ThumbStrip, VideoMeta, Waveform } from '@shared/types'
import { num, tr } from '@shared/i18n'
import { useApp } from '../store'
import { shortcutKey } from '../lib/keys'
import { autoLinkVerdict } from '@shared/link'
import { scoreSync } from '@shared/scoreSync'
import { fmtTime, mediaUrl, uid } from '../lib/format'
import Timeline, { type TimelineHandle } from './Timeline'
import ClipPanel from './ClipPanel'
import MatchPanel, { type AutoSyncState } from './MatchPanel'
import ReviewPanel from './ReviewPanel'
import { insights, type ReviewKind } from '../lib/review'
import { analyse, autoClips, offsetAt, type AutoClipOptions, type TLEvent } from '../lib/match'
import { introFor, recapItems } from '../lib/recap'

const DEFAULT_LEN = 10
const MIN_LEN = 0.2
const RATES = [0.25, 0.5, 1, 1.5, 2]

interface Snapshot {
  clips: Clip[]
  markers: Marker[]
}

function nextClipName(clips: Clip[]): string {
  let n = 0
  for (const c of clips) {
    const m = /^Clip (\d+)$/.exec(c.name)
    if (m) n = Math.max(n, Number(m[1]))
  }
  return `Clip ${Math.max(n, clips.length) + 1}`
}

export default function Editor({ path }: { path: string }): JSX.Element {
  const { settings, updateSettings, showToast, setExportsOpen, closeVideo, setShortcutsOpen } = useApp()

  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)

  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [clips, setClips] = useState<Clip[]>([])
  const [markers, setMarkers] = useState<Marker[]>([])
  const [projectLoaded, setProjectLoaded] = useState(false)
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  // Selecting a clip deselects the marker (and vice versa)
  const setSelectedId = useCallback((v: string | null | ((s: string | null) => string | null)) => {
    setSelectedIdRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      if (next) setSelectedMarkerId(null)
      return next
    })
  }, [])
  const selectMarker = useCallback((id: string | null) => {
    setSelectedMarkerId(id)
    if (id) setSelectedIdRaw(null)
  }, [])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [rate, setRate] = useState(1)
  const [snap, setSnap] = useState(true)
  const [thumbs, setThumbs] = useState<ThumbStrip | null>(null)
  const [wave, setWave] = useState<Waveform | null>(null)
  const [muted, setMuted] = useState(false)
  const [link, setLink] = useState<MatchLink | null>(null)
  const [autoTried, setAutoTried] = useState<'idle' | 'loading' | 'done'>('idle')
  const [tab, setTab] = useState<'clips' | 'match' | 'review'>('clips')
  const [reviewNotes, setReviewNotes] = useState<Record<string, ReviewNote>>({})
  const [reviewKind, setReviewKind] = useState<ReviewKind>('death')
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewAuto, setReviewAuto] = useState(true)
  const segmentEnd = useRef<(() => void) | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const playUntil = useRef<number | null>(null)
  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])

  const duration = meta?.duration ?? 0
  const fps = meta?.fps || 60
  const sortedClips = useMemo(() => [...clips].sort((a, b) => a.start - b.start), [clips])
  const selected = clips.find((c) => c.id === selectedId) ?? null

  // Match analysis (rounds, kills, deaths), recomputed when the link or the sync changes
  const analysis = useMemo(() => (link ? analyse(link) : null), [link])
  const events = analysis?.events ?? []
  const myKillEvents = useMemo(() => events.filter((e) => e.kind === 'kill'), [events])
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null
  const selectedEventIdRef = useRef(selectedEventId)
  selectedEventIdRef.current = selectedEventId

  const review = useMemo(() => (link && duration ? insights(link, duration) : null), [link, duration])
  const reviewList = useMemo(() => review?.items.filter((it) => it.kind === reviewKind) ?? [], [review, reviewKind])

  const st = useRef({ clips, markers, selectedId, selectedMarkerId, time, duration, fps, loop, selected, sortedClips, excluded, link, myKillEvents, reviewNotes, reviewList, reviewIndex, reviewAuto, tab })
  st.current = { clips, markers, selectedId, selectedMarkerId, time, duration, fps, loop, selected, sortedClips, excluded, link, myKillEvents, reviewNotes, reviewList, reviewIndex, reviewAuto, tab }

  /* ------------------------------ Loading ------------------------------ */

  useEffect(() => {
    let alive = true
    Promise.all([window.frag.probe(path), window.frag.getProject(path)])
      .then(([m, proj]) => {
        if (!alive) return
        setMeta(m)
        setClips(proj.clips)
        setMarkers(proj.markers)
        setReviewNotes(proj.review ?? {})
        setLink(proj.match ?? null)
        setProjectLoaded(true)
        window.frag.waveform(path).then((w) => alive && setWave(w)).catch(() => {})
        window.frag.thumbs(path).then((t) => alive && setThumbs(t)).catch(() => {})
      })
      .catch((e: Error) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [path])

  /* ------------------------------ Autosave ------------------------------ */

  const saveFailed = useRef(false)
  const dirty = useRef(false)
  const saveNow = useCallback(async () => {
    if (!projectLoaded) return
    dirty.current = false
    try {
      await window.frag.saveProject({
        videoPath: path,
        clips: st.current.clips,
        markers: st.current.markers,
        match: st.current.link,
        review: st.current.reviewNotes,
        updatedAt: Date.now()
      })
      saveFailed.current = false
    } catch (e) {
      dirty.current = true
      if (!saveFailed.current) {
        saveFailed.current = true
        const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e)
        showToast(tr(`Couldn’t save: ${msg}`, `Sauvegarde impossible : ${msg}`))
      }
    }
  }, [path, projectLoaded, showToast])

  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow
  useEffect(() => {
    if (!projectLoaded) return
    dirty.current = true
    const t = setTimeout(() => void saveNow(), 300)
    return () => clearTimeout(t)
  }, [clips, markers, link, reviewNotes, projectLoaded, saveNow])

  // Back to the library or app closing: write whatever hasn't been saved yet
  useEffect(() => {
    const flush = (): void => {
      if (dirty.current) void saveNowRef.current()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])
  saveNowRef.current = saveNow

  /* ------------------------------ Playback ------------------------------ */

  useEffect(() => {
    let id = 0
    const tick = (): void => {
      const v = videoRef.current
      if (v) {
        const t = v.currentTime
        const s = st.current
        if (!v.paused) {
          if (s.loop && s.selected && (t >= s.selected.end || t < s.selected.start - 0.25)) {
            v.currentTime = s.selected.start
          } else if (playUntil.current !== null && t >= playUntil.current) {
            v.pause()
            playUntil.current = null
            const done = segmentEnd.current
            segmentEnd.current = null
            done?.()
          }
        }
        setTime(t)
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (v && settings) v.volume = settings.volume
  }, [settings?.volume, ready])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate
  }, [rate])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    const d = st.current.duration || v.duration || 0
    const nt = Math.min(Math.max(0, t), Math.max(0, d - 0.001))
    v.currentTime = nt
    setTime(nt)
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    playUntil.current = null
    segmentEnd.current = null
    if (v.paused) {
      const s = st.current
      if (s.loop && s.selected && (v.currentTime < s.selected.start || v.currentTime >= s.selected.end)) {
        v.currentTime = s.selected.start
      }
      void v.play()
    } else v.pause()
  }, [])

  const playClip = useCallback((clip: Clip) => {
    const v = videoRef.current
    if (!v) return
    setSelectedId(clip.id)
    v.currentTime = clip.start
    playUntil.current = st.current.loop ? null : clip.end
    void v.play()
  }, [])

  const stepFrame = useCallback((dir: 1 | -1) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    const f = st.current.fps
    const frame = Math.floor(v.currentTime * f + 0.001)
    seek((frame + dir) / f + 0.0005)
  }, [seek])

  const nudge = useCallback((sec: number) => seek((videoRef.current?.currentTime ?? 0) + sec), [seek])

  /* ------------------------------ History ------------------------------ */

  const pushHistory = useCallback(() => {
    past.current.push({ clips: st.current.clips, markers: st.current.markers })
    if (past.current.length > 100) past.current.shift()
    future.current = []
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ clips: st.current.clips, markers: st.current.markers })
    setClips(prev.clips)
    setMarkers(prev.markers)
    if (st.current.selectedId && !prev.clips.some((c) => c.id === st.current.selectedId)) setSelectedId(null)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ clips: st.current.clips, markers: st.current.markers })
    setClips(next.clips)
    setMarkers(next.markers)
  }, [])

  /* ------------------------------ Clip editing ------------------------------ */

  const addClip = useCallback(
    (start: number, end: number) => {
      pushHistory()
      const clip: Clip = { id: uid(), name: nextClipName(st.current.clips), start, end }
      setClips((cs) => [...cs, clip])
      setSelectedId(clip.id)
      return clip
    },
    [pushHistory]
  )

  const updateClip = useCallback((id: string, patch: Partial<Clip>) => {
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  /** C: new clip of the last 10 seconds, ending at the playhead */
  const clipHere = useCallback(() => {
    const { time: t, duration: d } = st.current
    if (!d) return
    const end = Math.max(Math.min(d, t), Math.min(d, MIN_LEN * 5))
    addClip(Math.max(0, end - DEFAULT_LEN), end)
  }, [addClip])

  const setIn = useCallback(() => {
    const { time: t, duration: d, selected: sel } = st.current
    if (!d) return
    if (!sel) {
      addClip(t, Math.min(d, t + DEFAULT_LEN))
      return
    }
    pushHistory()
    if (t <= sel.end - MIN_LEN) updateClip(sel.id, { start: t })
    else updateClip(sel.id, { start: t, end: Math.min(d, t + (sel.end - sel.start)) })
  }, [addClip, pushHistory, updateClip])

  const setOut = useCallback(() => {
    const { time: t, duration: d, selected: sel } = st.current
    if (!d || t < MIN_LEN) return
    if (!sel) {
      addClip(Math.max(0, t - DEFAULT_LEN), t)
      return
    }
    pushHistory()
    if (t >= sel.start + MIN_LEN) updateClip(sel.id, { end: t })
    else updateClip(sel.id, { end: t, start: Math.max(0, t - (sel.end - sel.start)) })
  }, [addClip, pushHistory, updateClip])

  const deleteClip = useCallback(
    (id: string) => {
      pushHistory()
      setClips((cs) => cs.filter((c) => c.id !== id))
      setSelectedId((s) => (s === id ? null : s))
    },
    [pushHistory]
  )

  const renameClip = useCallback(
    (id: string, name: string) => {
      pushHistory()
      updateClip(id, { name })
    },
    [pushHistory, updateClip]
  )

  const addMarker = useCallback(() => {
    const t = st.current.time
    if (st.current.markers.some((m) => Math.abs(m.time - t) < 0.1)) return
    pushHistory()
    setMarkers((ms) => [...ms, { id: uid(), time: t }].sort((a, b) => a.time - b.time))
  }, [pushHistory])

  const removeMarker = useCallback(
    (id: string) => {
      pushHistory()
      setMarkers((ms) => ms.filter((m) => m.id !== id))
      setSelectedMarkerId((s) => (s === id ? null : s))
    },
    [pushHistory]
  )

  /** Shift+M: delete the marker closest to the playhead (within 1 s) */
  const removeMarkerNearPlayhead = useCallback(() => {
    const { time: t, markers: ms } = st.current
    let best: Marker | null = null
    for (const m of ms) if (Math.abs(m.time - t) <= 1 && (!best || Math.abs(m.time - t) < Math.abs(best.time - t))) best = m
    if (best) removeMarker(best.id)
  }, [removeMarker])

  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      const { time: t, markers: ms, sortedClips: cs } = st.current
      const points = [...ms.map((m) => m.time), ...cs.flatMap((c) => [c.start, c.end])].sort((a, b) => a - b)
      const target = dir > 0 ? points.find((p) => p > t + 0.05) : [...points].reverse().find((p) => p < t - 0.05)
      if (target !== undefined) seek(target)
    },
    [seek]
  )

  /* ------------------------------ Export ------------------------------ */

  const exportClips = useCallback(
    async (list: Clip[]) => {
      if (!list.length || !settings) return
      await saveNow()
      const sorted = [...list].sort((a, b) => a.start - b.start)
      await window.frag.exportClips(path, sorted, {
        mode: settings.exportMode,
        quality: settings.quality,
        audio: settings.audio
      })
      const what =
        sorted.length === 1
          ? tr(`“${sorted[0].name}” added to exports`, `« ${sorted[0].name} » ajouté à l’export`)
          : tr(`${sorted.length} clips added to exports`, `${sorted.length} clips ajoutés à l’export`)
      showToast(what, {
        label: tr('View', 'Voir'),
        run: () => setExportsOpen(true)
      })
    },
    [path, saveNow, settings, setExportsOpen, showToast]
  )

  /* ------------------------------ Match (HenrikDev) ------------------------------ */

  const findMe = (match: MatchData, account: RiotAccount): MatchData['players'][number] | undefined =>
    match.players.find((p) => account.puuid && p.puuid === account.puuid) ??
    match.players.find((p) => `${p.name}#${p.tag}`.toLowerCase() === account.riotId.toLowerCase())

  const linkMatch = useCallback(
    async (match: MatchData, account: RiotAccount, silent = false) => {
      const me = findMe(match, account)
      const times = await window.frag.recTimes(path)
      // Recording start time vs match start time → first sync estimate
      const autoOffset = times.ok ? (times.data.start - match.startedAt) / 1000 : null
      // Recorded with auto-record: the round ends noted during the game sync it right away
      const sync = times.ok && me ? scoreSync(match, me.puuid, times.data.rounds) : null
      const anchors = sync ? [{ id: uid(), matchTime: sync.matchTime, videoTime: sync.videoTime, label: tr('round score', 'score des rounds') }] : []
      setLink({ match, puuid: me?.puuid ?? '', autoOffset, anchors })
      setTab('match')
      if (!silent) {
        showToast(
          tr(
            `Match linked: ${match.map}${sync ? ', synced on the round score' : ''}`,
            `Match lié : ${match.map}${sync ? ', calé sur le score des rounds' : ''}`
          )
        )
      }
    },
    [path, showToast]
  )

  // When opening an unlinked recording: look for its match automatically
  const autoStarted = useRef(false)
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    // In dev, React mounts / unmounts / remounts: reset the flag on every mount
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!projectLoaded || link || autoStarted.current || !settings) return
    if (!settings.hasHenrikKey || !settings.accounts.length) return
    autoStarted.current = true
    setAutoTried('loading')
    const account = settings.accounts[0]
    window.frag.matchCandidates(path, account.region, account.riotId).then(async (res) => {
      // Whatever happens, leave the "searching" state (otherwise the panel spins forever)
      setAutoTried('done')
      if (!mounted.current) return
      const best = res.ok ? res.data[0] : undefined
      const verdict = autoLinkVerdict(best, settings.minLinkMinutes ?? 5)
      setAutoNote(verdict.reason)
      if (best && verdict.ok) {
        await linkMatch(best.match, account, true)
        const me = findMe(best.match, account)
        const team = best.match.teams.find((t) => t.id === me?.team)
        showToast(
          tr(
            `Match found: ${best.match.map}${team ? ` · ${team.won ? 'win' : 'loss'} ${team.roundsWon}–${team.roundsLost}` : ''}. Sync a round to be precise.`,
            `Match trouvé : ${best.match.map}${team ? ` · ${team.won ? 'victoire' : 'défaite'} ${team.roundsWon}–${team.roundsLost}` : ''}. Cale un round pour être précis.`
          ),
          { label: tr('Sync', 'Caler'), run: () => setTab('match') }
        )
      }
      setAutoTried('done')
    })
  }, [projectLoaded, link, settings, path, linkMatch, showToast])

  // Recording linked in the background after the game (auto-record) while it's open
  useEffect(
    () =>
      window.frag.onProjectLinked((p) => {
        if (p !== path || st.current.link) return
        window.frag.getProject(path).then((proj) => {
          if (proj.match && !st.current.link) {
            setLink(proj.match)
            showToast(tr(`Match linked: ${proj.match.match.map}`, `Match lié : ${proj.match.match.map}`))
          }
        })
      }),
    [path, showToast]
  )

  const anchorAt = useCallback((matchTime: number, label: string) => {
    const v = videoRef.current?.currentTime ?? st.current.time
    // A sync point re-syncs the whole match: it replaces the previous one
    setLink((l) => (l ? { ...l, anchors: [{ id: uid(), matchTime, videoTime: v, label }] } : l))
  }, [])

  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState>({ running: false, progress: 0 })

  const applyAutoSync = useCallback(
    (r: AutoSyncResult) => {
      const l = st.current.link
      if (!l) return
      // an anchor in the middle of the match's kills, with the offset found
      const ks = l.match.kills.map((k) => k.tMatch).sort((a, b) => a - b)
      const m = ks[Math.floor(ks.length / 2)] ?? 0
      setLink((x) =>
        x ? { ...x, anchors: [{ id: uid(), matchTime: m, videoTime: m - r.offset, label: `auto ${Math.round(r.confidence * 100)} %` }] } : x
      )
      showToast(tr('Match synced automatically from the killfeed', 'Match calé automatiquement sur le killfeed'))
    },
    [showToast]
  )

  const runAutoSync = useCallback(async () => {
    const l = st.current.link
    if (!l) return
    setAutoSyncState({ running: true, progress: 0 })
    const guess = l.anchors.length ? l.anchors[0].matchTime - l.anchors[0].videoTime : l.autoOffset
    const off = window.frag.onAutoSyncProgress(({ path: p, progress }) => {
      if (p === path) setAutoSyncState((s) => ({ ...s, progress }))
    })
    const res = await window.frag.autoSync(path, l.match, guess)
    off()
    if (!res.ok) {
      setAutoSyncState({ running: false, progress: 0, error: res.error })
      return
    }
    setAutoSyncState({ running: false, progress: 1, result: res.data })
    if (res.data.confidence >= 0.5) applyAutoSync(res.data)
  }, [path, applyAutoSync])

  const anchorRound = useCallback(
    (roundIndex: number) => {
      const r = st.current.link?.match.rounds[roundIndex]
      if (!r || r.start === null) return
      anchorAt(r.start, `R${roundIndex + 1}`)
      showToast(tr(`Synced on round ${roundIndex + 1}`, `Synchro calée sur le round ${roundIndex + 1}`))
    },
    [anchorAt, showToast]
  )

  const anchorKill = useCallback(
    (killIndex: number) => {
      const k = st.current.link?.match.kills[killIndex]
      if (!k) return
      anchorAt(k.tMatch, `kill R${k.round + 1}`)
      showToast(tr(`The whole match is synced on this round ${k.round + 1} kill`, `Tout le match est calé sur ce kill du round ${k.round + 1}`))
    },
    [anchorAt, showToast]
  )

  /** Shift the active sync point (the one under the playhead) by `delta` seconds */
  const nudgeSync = useCallback((delta: number) => {
    setLink((l) => {
      if (!l) return l
      if (!l.anchors.length) return { ...l, autoOffset: (l.autoOffset ?? 0) - delta }
      const m = st.current.time + offsetAt(l, st.current.time)
      let target = l.anchors[0]
      for (const a of [...l.anchors].sort((x, y) => x.matchTime - y.matchTime)) if (a.matchTime <= m + 0.5) target = a
      return { ...l, anchors: l.anchors.map((a) => (a.id === target.id ? { ...a, videoTime: a.videoTime + delta } : a)) }
    })
  }, [])

  const selectEvent = useCallback(
    (id: string) => {
      const ev = st.current.link ? analyse(st.current.link).events.find((e) => e.id === id) : undefined
      setSelectedEventId(id)
      if (ev) seek(Math.max(0, ev.t - 2))
    },
    [seek]
  )

  const jumpKill = useCallback(
    (dir: 1 | -1) => {
      const { time: t, myKillEvents: ks } = st.current
      const inRange = ks.filter((k) => k.t >= 0 && k.t <= st.current.duration)
      // We land 2 s before the kill, so compare with t + 2
      const ref = t + 2
      const target = dir > 0 ? inRange.find((k) => k.t > ref + 0.3) : [...inRange].reverse().find((k) => k.t < ref - 0.3)
      if (target) {
        setSelectedEventId(target.id)
        seek(Math.max(0, target.t - 2))
      }
    },
    [seek]
  )

  const makeAutoClips = useCallback(
    (opts: AutoClipOptions): number => {
      const l = st.current.link
      if (!l || !analysis) return 0
      const list = autoClips(l, analysis.rounds, opts, st.current.duration, st.current.clips)
      if (!list.length) return 0
      pushHistory()
      setClips((cs) => [...cs, ...list.map((c) => ({ ...c, id: uid() }))])
      setTab('clips')
      showToast(list.length === 1 ? tr('1 clip created', '1 clip créé') : tr(`${list.length} clips created`, `${list.length} clips créés`))
      return list.length
    },
    [analysis, pushHistory, showToast]
  )

  /** Match recap: the intro card, then every highlight, Broadcast style, straight into the exports */
  const [recapBusy, setRecapBusy] = useState(false)
  const makeRecap = useCallback(
    async (opts: AutoClipOptions): Promise<void> => {
      const l = st.current.link
      if (!l || !analysis) return
      const items = recapItems(l, analysis.rounds, path, st.current.duration, opts)
      if (!items.length) {
        showToast(tr('No highlights at this setting', 'Aucun temps fort avec ce réglage'))
        return
      }
      setRecapBusy(true)
      const intro = introFor(l)
      const res = await window.frag.exportMontage(items, {
        transition: 0,
        name: `${intro.map} ${intro.us}-${intro.them} · ${tr('recap', 'résumé')}`,
        style: 'broadcast',
        intro
      })
      setRecapBusy(false)
      if (!res.ok) {
        showToast(res.error)
        return
      }
      showToast(
        items.length === 1 ? tr('Recap queued: intro + 1 highlight', 'Résumé en file : intro + 1 temps fort') : tr(`Recap queued: intro + ${items.length} highlights`, `Résumé en file : intro + ${items.length} temps forts`),
        { label: tr('View', 'Voir'), run: () => setExportsOpen(true) }
      )
    },
    [analysis, path, showToast, setExportsOpen]
  )

  const previewAutoClips = useCallback(
    (opts: AutoClipOptions): number =>
      link && analysis ? autoClips(link, analysis.rounds, opts, duration, clips).length : 0,
    [link, analysis, duration, clips]
  )

  /* ------------------------------ Review ------------------------------ */

  const playReview = useCallback(
    (i: number) => {
      const v = videoRef.current
      const list = st.current.reviewList
      const item = list[i]
      if (!v || !item) return
      setReviewIndex(i)
      v.currentTime = item.start
      playUntil.current = item.end
      // At the end of the moment: move on to the next one if autoplay is on
      segmentEnd.current = () => {
        const s = st.current
        if (s.reviewAuto && s.tab === 'review' && i + 1 < s.reviewList.length) {
          setTimeout(() => playReviewRef.current(i + 1), 700)
        }
      }
      void v.play()
    },
    []
  )
  const playReviewRef = useRef(playReview)
  playReviewRef.current = playReview

  const toggleReview = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (!v.paused) {
      v.pause()
      segmentEnd.current = null
      playUntil.current = null
    } else playReview(st.current.reviewIndex)
  }, [playReview])

  const setNote = useCallback((key: string, note: ReviewNote) => {
    setReviewNotes((n) => {
      const next = { ...n }
      if (!note.tags.length && !note.note.trim()) delete next[key]
      else next[key] = note
      return next
    })
  }, [])

  /* ------------------------------ Shortcuts ------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return
      const ui = useApp.getState()
      if (ui.settingsOpen || ui.shortcutsOpen || ui.montageOpen) return
      const k = shortcutKey(e.key)
      const ctrl = e.ctrlKey || e.metaKey
      const s = st.current

      const handled = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }

      if (ctrl && k.toLowerCase() === 'z') {
        handled()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (ctrl && k.toLowerCase() === 'y') {
        handled()
        redo()
        return
      }
      if (ctrl) return

      switch (k) {
        case ' ':
          handled()
          togglePlay()
          break
        case 'ArrowLeft':
          handled()
          if (e.shiftKey) nudge(-1)
          else stepFrame(-1)
          break
        case 'ArrowRight':
          handled()
          if (e.shiftKey) nudge(1)
          else stepFrame(1)
          break
        case 'j':
        case 'J':
          handled()
          nudge(-5)
          break
        case 'l':
        case 'L':
          handled()
          nudge(5)
          break
        case 'k':
        case 'K':
          handled()
          videoRef.current?.pause()
          break
        case 'i':
        case 'I':
          handled()
          setIn()
          break
        case 'o':
        case 'O':
          handled()
          setOut()
          break
        case 'c':
        case 'C':
          handled()
          clipHere()
          break
        case 'm':
        case 'M':
          handled()
          if (e.shiftKey) removeMarkerNearPlayhead()
          else addMarker()
          break
        case 'n':
        case 'N':
          handled()
          jumpKill(e.shiftKey ? -1 : 1)
          break
        case 'r':
        case 'R':
          handled()
          setLoop((v) => !v)
          break
        case 'e':
        case 'E':
          handled()
          if (e.shiftKey) void exportClips(s.sortedClips.filter((c) => !s.excluded.has(c.id)))
          else if (s.selected) void exportClips([s.selected])
          break
        case '[':
          handled()
          if (s.selected) seek(s.selected.start)
          break
        case ']':
          handled()
          if (s.selected) seek(s.selected.end - 0.001)
          break
        case 'ArrowUp':
          handled()
          jumpMarker(-1)
          break
        case 'ArrowDown':
          handled()
          jumpMarker(1)
          break
        case 'Home':
          handled()
          seek(0)
          break
        case 'End':
          handled()
          seek(s.duration)
          break
        case 'Delete':
        case 'Backspace':
          handled()
          if (s.selectedMarkerId) removeMarker(s.selectedMarkerId)
          else if (s.selectedId) deleteClip(s.selectedId)
          break
        case ',':
          if (s.tab === 'review') {
            handled()
            playReview(Math.max(0, s.reviewIndex - 1))
          }
          break
        case '.':
          if (s.tab === 'review') {
            handled()
            playReview(Math.min(s.reviewList.length - 1, s.reviewIndex + 1))
          }
          break
        case 'Tab': {
          handled()
          const list = s.sortedClips
          if (!list.length) break
          const i = list.findIndex((c) => c.id === s.selectedId)
          const next = e.shiftKey ? list[(i - 1 + list.length) % list.length] : list[(i + 1) % list.length]
          setSelectedId(next.id)
          seek(next.start)
          break
        }
        case 'Enter':
          handled()
          if (s.selected) playClip(s.selected)
          break
        case '+':
        case '=':
          handled()
          timelineRef.current?.zoomIn()
          break
        case '-':
        case '_':
          handled()
          timelineRef.current?.zoomOut()
          break
        case '0':
          handled()
          timelineRef.current?.fit()
          break
        case '?':
          handled()
          setShortcutsOpen(true)
          break
        case 'Escape':
          handled()
          if (selectedEventIdRef.current) setSelectedEventId(null)
          else if (s.selectedMarkerId) setSelectedMarkerId(null)
          else if (s.selectedId) setSelectedId(null)
          else closeVideo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    addMarker, clipHere, closeVideo, deleteClip, exportClips, jumpMarker, nudge, playClip, redo, seek,
    setIn, setOut, setShortcutsOpen, stepFrame, togglePlay, undo, removeMarker, removeMarkerNearPlayhead,
    setSelectedId, jumpKill, playReview
  ])

  /* ------------------------------ Render ------------------------------ */

  if (loadError) {
    return (
      <div className="empty-hero">
        <div className="empty-icon is-error">
          <AlertTriangle size={26} />
        </div>
        <h1>{tr('Can’t open this video', 'Impossible d’ouvrir cette vidéo')}</h1>
        <p className="mono-msg">{loadError}</p>
        <button className="btn btn-ghost btn-lg" onClick={closeVideo}>
          {tr('Back to library', 'Retour à la bibliothèque')}
        </button>
      </div>
    )
  }

  const volume = settings?.volume ?? 0.8

  return (
    <div className="editor">
      <section className="stage">
        <div className="player">
          <video
            ref={videoRef}
            src={mediaUrl(path)}
            preload="auto"
            muted={muted}
            onClick={togglePlay}
            onDoubleClick={(e) => e.preventDefault()}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedData={() => setReady(true)}
            onError={() =>
              setPlayError(
                tr(
                  'The player can’t read this file. If it’s HEVC/H.265, install Windows’ “HEVC Video Extensions” or switch OBS back to H.264.',
                  'Le lecteur n’arrive pas à lire ce fichier. Si c’est du HEVC/H.265, installe l’extension « HEVC Video Extensions » de Windows ou repasse OBS en H.264.'
                )
              )
            }
          />
          {(!ready || !meta) && !playError && (
            <div className="player-overlay">
              <Loader2 className="spin" size={22} />
            </div>
          )}
          {playError && (
            <div className="player-overlay is-error">
              <AlertTriangle size={20} />
              <span>{playError}</span>
            </div>
          )}
          {selected && (
            <div className="player-tag">
              <Scissors size={12} />
              {selected.name}
              {loop && <span className="player-tag-loop">{tr('loop', 'boucle')}</span>}
            </div>
          )}
        </div>

        <div className="transport">
          <div className="transport-left">
            <button className="icon-btn" onClick={() => stepFrame(-1)} title={`${tr('Previous frame', 'Image précédente')} (←)`}>
              <StepBack size={16} />
            </button>
            <button className="play-btn" onClick={togglePlay} title={tr('Play / pause (Space)', 'Lecture / pause (Espace)')}>
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <button className="icon-btn" onClick={() => stepFrame(1)} title={`${tr('Next frame', 'Image suivante')} (→)`}>
              <StepForward size={16} />
            </button>
            <div className="timecode">
              <span>{fmtTime(time)}</span>
              <span className="timecode-total">/ {fmtTime(duration)}</span>
            </div>
          </div>
          <div className="transport-right">
            <button
              className={`chip-btn ${loop ? 'is-on' : ''}`}
              onClick={() => setLoop((v) => !v)}
              title={tr('Loop the selected clip (R)', 'Lire le clip sélectionné en boucle (R)')}
            >
              <Repeat size={14} />
              {tr('Loop', 'Boucle')}
            </button>
            <div className="rate">
              {RATES.map((r) => (
                <button key={r} className={r === rate ? 'is-on' : ''} onClick={() => setRate(r)}>
                  {num(r, r % 1 ? 2 : 0).replace(/([.,]\d)0$/, '$1')}×
                </button>
              ))}
            </div>
            <div className="volume">
              <button className="icon-btn" onClick={() => setMuted((m) => !m)} title={tr('Mute', 'Couper le son')}>
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                className="slider"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false)
                  const v = Number(e.target.value)
                  if (videoRef.current) videoRef.current.volume = v
                  void updateSettings({ volume: v })
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <aside className="side">
        <div className="side-tabs">
          <button className={tab === 'clips' ? 'is-on' : ''} onClick={() => setTab('clips')}>
            Clips
            {clips.length > 0 && <span className="count">{clips.length}</span>}
          </button>
          <button className={tab === 'match' ? 'is-on' : ''} onClick={() => setTab('match')}>
            Match
            {link ? (
              <span className={`tab-dot ${link.anchors.length ? 'is-ok' : 'is-warn'}`} />
            ) : null}
          </button>
          <button className={tab === 'review' ? 'is-on' : ''} onClick={() => setTab('review')}>
            {tr('Review', 'Revoir')}
            {review && review.deaths > 0 && <span className="count">{review.deaths}</span>}
          </button>
        </div>
        {tab === 'review' ? (
          <ReviewPanel
            link={link}
            data={review}
            kind={reviewKind}
            index={reviewIndex}
            auto={reviewAuto}
            playing={playing}
            notes={reviewNotes}
            onKind={(k) => {
              setReviewKind(k)
              setReviewIndex(0)
            }}
            onPlay={playReview}
            onTogglePlay={toggleReview}
            onAuto={setReviewAuto}
            onNote={setNote}
            onGoMatch={() => setTab('match')}
          />
        ) : tab === 'clips' ? (
          <ClipPanel
            clips={sortedClips}
            selectedId={selectedId}
            excluded={excluded}
            audioTracks={meta?.audioTracks ?? 0}
            onSelect={(id) => {
              setSelectedId(id)
              const c = clips.find((x) => x.id === id)
              if (c) seek(c.start)
            }}
            onPlay={playClip}
            onRename={renameClip}
            onDelete={deleteClip}
            onToggle={(id) =>
              setExcluded((ex) => {
                const n = new Set(ex)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })
            }
            onToggleAll={(include) => setExcluded(include ? new Set() : new Set(clips.map((c) => c.id)))}
            onExport={exportClips}
          />
        ) : (
          <MatchPanel
            path={path}
            duration={duration}
            time={time}
            link={link}
            rounds={analysis?.rounds ?? []}
            selectedEvent={selectedEvent}
            autoTried={autoTried}
            autoNote={autoNote}
            onSkipAuto={() => setAutoTried('done')}
            onLink={(m, account) => void linkMatch(m, account)}
            onUnlink={() => {
              setLink(null)
              setAutoTried('done')
              setSelectedEventId(null)
            }}
            onSetPuuid={(puuid) => setLink((l) => (l ? { ...l, puuid } : l))}
            onAnchorRound={anchorRound}
            onAnchorKill={anchorKill}
            autoSync={autoSyncState}
            onAutoSync={() => void runAutoSync()}
            onApplyAutoSync={() => autoSyncState.result && applyAutoSync(autoSyncState.result)}
            onNudge={nudgeSync}
            onResetSync={() => setLink((l) => (l ? { ...l, anchors: [] } : l))}
            onSeek={seek}
            onSelectEvent={selectEvent}
            onAutoClips={makeAutoClips}
            previewAutoClips={previewAutoClips}
            onRecap={makeRecap}
            recapBusy={recapBusy}
          />
        )}
      </aside>

      <section className="timeline-wrap">
        {meta ? (
          <Timeline
            ref={timelineRef}
            duration={duration}
            time={time}
            playing={playing}
            aspect={meta.width && meta.height ? meta.width / meta.height : 16 / 9}
            clips={clips}
            markers={markers}
            selectedId={selectedId}
            thumbs={thumbs}
            wave={wave}
            snap={snap}
            onSnapChange={setSnap}
            onSeek={seek}
            onSelect={setSelectedId}
            onClipEditStart={pushHistory}
            onClipChange={(id, start, end) => updateClip(id, { start, end })}
            onClipEditEnd={() => {}}
            selectedMarkerId={selectedMarkerId}
            onMarkerSelect={selectMarker}
            onMarkerRemove={removeMarker}
            matchRounds={analysis?.rounds ?? null}
            events={events}
            selectedEventId={selectedEventId}
            onEventSelect={selectEvent}
            tools={
              <>
                <button className="tool-btn" onClick={setIn} title={tr('Clip start at the playhead', 'Début du clip à la tête de lecture')}>
                  <ArrowLeftToLine size={15} />
                  {tr('In', 'Début')} <kbd>I</kbd>
                </button>
                <button className="tool-btn" onClick={setOut} title={tr('Clip end at the playhead', 'Fin du clip à la tête de lecture')}>
                  <ArrowRightToLine size={15} />
                  {tr('Out', 'Fin')} <kbd>O</kbd>
                </button>
                <button
                  className="tool-btn is-accent"
                  onClick={clipHere}
                  title={tr('New clip of the last 10 seconds', 'Nouveau clip des 10 dernières secondes')}
                >
                  <Scissors size={15} />
                  {tr('Clip it', 'Clip ici')} <kbd>C</kbd>
                </button>
                <button className="tool-btn" onClick={addMarker} title={tr('Drop a marker', 'Poser un marqueur')}>
                  <Flag size={15} />
                  {tr('Marker', 'Marqueur')} <kbd>M</kbd>
                </button>
                <span className="tl-sep" />
                <button className="icon-btn" onClick={undo} title={tr('Undo (Ctrl+Z)', 'Annuler (Ctrl+Z)')} disabled={!past.current.length}>
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-btn"
                  onClick={redo}
                  title={tr('Redo (Ctrl+Shift+Z)', 'Rétablir (Ctrl+Maj+Z)')}
                  disabled={!future.current.length}
                >
                  <Redo2 size={15} />
                </button>
              </>
            }
          />
        ) : (
          <div className="timeline-loading">
            <Loader2 className="spin" size={18} />
          </div>
        )}
      </section>
    </div>
  )
}
