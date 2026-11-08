import { useEffect, useState } from 'react'
import { X, FolderOpen, RotateCcw, Square, CheckCircle2, AlertCircle, Clock, Loader2, Ban } from 'lucide-react'
import type { ExportJob } from '@shared/types'
import { useApp } from '../store'
import { baseName, fmtClipLen } from '../lib/format'

const ENCODER_LABEL = { nvenc: 'NVENC', cpu: 'CPU', copy: 'Copie' } as const

function JobRow({ job }: { job: ExportJob }): JSX.Element {
  const pct = Math.round(job.progress * 100)
  const icon =
    job.status === 'done' ? (
      <CheckCircle2 size={16} className="ok" />
    ) : job.status === 'error' ? (
      <AlertCircle size={16} className="err" />
    ) : job.status === 'running' ? (
      <Loader2 size={16} className="spin accent" />
    ) : job.status === 'canceled' ? (
      <Ban size={16} className="faint" />
    ) : (
      <Clock size={16} className="faint" />
    )

  return (
    <div className={`job is-${job.status}`}>
      <div className="job-icon">{icon}</div>
      <div className="job-main">
        <div className="job-name" title={job.outputPath}>
          {baseName(job.outputPath)}
        </div>
        <div className="job-sub">
          <span>{fmtClipLen(job.end - job.start)}</span>
          {job.encoder && <span className="pill">{ENCODER_LABEL[job.encoder]}</span>}
          {job.status === 'running' && <span>{pct} %</span>}
          {job.status === 'queued' && <span>En attente</span>}
          {job.status === 'canceled' && <span>Annulé</span>}
        </div>
        {job.status === 'running' && (
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        {job.status === 'error' && <div className="job-error">{job.error}</div>}
      </div>
      <div className="job-actions">
        {job.status === 'done' && (
          <button className="icon-btn" title="Afficher dans le dossier" onClick={() => window.frag.showItem(job.outputPath)}>
            <FolderOpen size={15} />
          </button>
        )}
        {(job.status === 'running' || job.status === 'queued') && (
          <button className="icon-btn is-danger" title="Annuler" onClick={() => window.frag.cancelJob(job.id)}>
            <Square size={13} />
          </button>
        )}
        {(job.status === 'error' || job.status === 'canceled') && (
          <button className="icon-btn" title="Réessayer" onClick={() => window.frag.retryJob(job.id)}>
            <RotateCcw size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function ExportsDrawer(): JSX.Element {
  const { exportsOpen, setExportsOpen, jobs, settings } = useApp()
  const [outFolder, setOutFolder] = useState<string | null>(null)

  useEffect(() => {
    if (exportsOpen) window.frag.outputFolder().then(setOutFolder)
  }, [exportsOpen, settings?.outputFolder, settings?.recsFolder])

  useEffect(() => {
    if (!exportsOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setExportsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [exportsOpen, setExportsOpen])

  const list = [...jobs].reverse()
  const finished = jobs.filter((j) => j.status !== 'queued' && j.status !== 'running').length

  return (
    <>
      <div className={`scrim ${exportsOpen ? 'is-open' : ''}`} onClick={() => setExportsOpen(false)} />
      <aside className={`drawer ${exportsOpen ? 'is-open' : ''}`}>
        <div className="drawer-head">
          <h2>Exports</h2>
          <button className="icon-btn" onClick={() => setExportsOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-tools">
          {outFolder && (
            <button className="btn btn-ghost btn-sm" onClick={() => window.frag.openFolder(outFolder)}>
              <FolderOpen size={14} />
              Ouvrir le dossier
            </button>
          )}
          {finished > 0 && (
            <button className="link-btn" onClick={() => window.frag.clearJobs()}>
              Vider les terminés
            </button>
          )}
        </div>
        <div className="drawer-body">
          {list.length === 0 ? (
            <div className="drawer-empty">Aucun export pour l’instant. Tes clips exportés apparaîtront ici.</div>
          ) : (
            list.map((j) => <JobRow key={j.id} job={j} />)
          )}
        </div>
      </aside>
    </>
  )
}
