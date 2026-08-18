/** Sidebar-footer Vault trigger and the full-viewport upload/notes/graph
 * page it opens, modeled on the Settings modal (mask + centered panel,
 * Escape/mask-click to close). */
import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCloseOutline16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { VaultGraphData, VaultNote, VaultPanelFace } from './slots.ts'
import { runVaultGraph } from './graph.ts'
import css from './VaultPanel.module.css'

export type VaultPanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<VaultPanelFace> & PropsLocale<'vault'>

type PageProps = {
  baseUrl: string
  t: VaultPanelProps['t']
  onClose: () => void
}

/** The modal layer: full-viewport mask + centered panel, two columns (notes/upload, graph). */
function VaultPage({ baseUrl, t, onClose }: PageProps) {
  const [data, setData] = useState<VaultGraphData>()
  const [loadError, setLoadError] = useState<string>()
  const [uploadStatus, setUploadStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  useEffect(() => { closeButton.current?.focus() }, [])

  const load = (): void => {
    setLoadError(undefined)
    fetch(`${baseUrl}/vault/graph-data`)
      .then(res => res.json() as Promise<VaultGraphData>)
      .then(setData)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error))
      })
  }

  useEffect(load, [baseUrl])

  useEffect(() => {
    if (data === undefined || canvasRef.current === null) return
    return runVaultGraph(canvasRef.current, data.graph)
  }, [data])

  const upload = (file: File): void => {
    setUploadStatus({ kind: 'busy' })
    const form = new FormData()
    form.append('file', file)
    fetch(`${baseUrl}/vault/upload`, { method: 'POST', body: form })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setUploadStatus({ kind: 'ok', message: file.name })
        load()
      })
      .catch((error: unknown) => {
        setUploadStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
  }

  const renderNote = (note: VaultNote) => (
    <li key={note.id} className={css.row}>
      <div className={css.rowHead}>
        <span className={css.rowName}>{note.title}</span>
        <span className={css.rowLinks}>{t('panel.notes.links', { count: note.links.length })}</span>
      </div>
      <div className={css.rowSnippet}>{note.snippet}</div>
    </li>
  )

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={css.header}>
          <span className={css.title} id={titleId}>{t('panel.title')}</span>
          <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
            <IconCloseOutline16 size={14} />
            <span className={css.hiddenLabel}>{t('panel.close')}</span>
          </button>
        </header>
        <div className={css.body}>
          <div className={css.column}>
            <div className={css.uploadRow}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.md,.txt"
                className={css.fileInput}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file !== undefined) upload(file)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className={css.uploadButton}
                disabled={uploadStatus.kind === 'busy'}
                onClick={() => { fileInputRef.current?.click() }}
              >
                {t('panel.upload.button')}
              </button>
            </div>
            {uploadStatus.kind === 'busy' && <p className={css.note}>{t('panel.upload.uploading')}</p>}
            {uploadStatus.kind === 'ok' && (
              <p className={css.note}>{t('panel.upload.done', { name: uploadStatus.message ?? '' })}</p>
            )}
            {uploadStatus.kind === 'error' && (
              <p className={css.readError} role="alert">
                {t('panel.upload.failed', { message: uploadStatus.message ?? '' })}
              </p>
            )}
            {loadError !== undefined && (
              <p className={css.readError} role="alert">{t('panel.loadFailed', { message: loadError })}</p>
            )}

            <h3 className={css.group}>{t('panel.notes.count', { count: data?.notes.length ?? 0 })}</h3>
            {data !== undefined && data.notes.length === 0 && <p className={css.note}>{t('panel.notes.empty')}</p>}
            <ul className={css.rows}>{data?.notes.map(renderNote)}</ul>
          </div>
          <div className={css.column}>
            <h3 className={css.group}>{t('panel.graph.title')}</h3>
            <canvas ref={canvasRef} className={css.graph} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Render the Vault sidebar trigger and, when open, the full-page overlay. */
export function VaultPanel({ wide, baseUrl, t }: VaultPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={wide ? css.layer : `${css.layer} ${css.rail}`}>
      <div className={css.footerButtons}>
        <button
          type="button"
          className={css.badge}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconFolderOpen16 size={wide ? 16 : 18} />
          {wide && <span className={css.badgeLabel}>{t('panel.trigger')}</span>}
        </button>
      </div>
      {open && <VaultPage baseUrl={baseUrl} t={t} onClose={() => { setOpen(false) }} />}
    </div>
  )
}
