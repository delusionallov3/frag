import { promises as fs } from 'fs'
import { extname, join } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { VideoEntry } from '@shared/types'
import { projectSummary } from './store'
import { probe } from './ffmpeg'

export const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.webm'])

export async function listVideos(folder: string): Promise<VideoEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(folder)
  } catch {
    return []
  }
  const entries = await Promise.all(
    names
      .filter((n) => VIDEO_EXT.has(extname(n).toLowerCase()))
      .map(async (name) => {
        const path = join(folder, name)
        try {
          const st = await fs.stat(path)
          if (!st.isFile()) return null
          return {
            path,
            name,
            size: st.size,
            mtime: st.mtimeMs,
            duration: await probe(path)
              .then((m) => m.duration)
              .catch(() => null),
            ...(await projectSummary(path))
          } satisfies VideoEntry
        } catch {
          return null
        }
      })
  )
  return entries.filter((e): e is VideoEntry => e !== null).sort((a, b) => b.mtime - a.mtime)
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

export async function watchFolder(folder: string | null, onChange: () => void): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (!folder) return
  watcher = chokidar.watch(folder, {
    depth: 0,
    ignoreInitial: true,
    // OBS writes the file for the whole game: wait until it's stable
    awaitWriteFinish: { stabilityThreshold: 4000, pollInterval: 500 }
  })
  const fire = (p: string): void => {
    if (!VIDEO_EXT.has(extname(p).toLowerCase())) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 300)
  }
  watcher.on('add', fire).on('unlink', fire).on('change', fire)
}
