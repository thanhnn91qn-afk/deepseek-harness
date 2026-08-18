/** Sidebar-footer Vault panel: upload .docx/.pdf/.md/.txt, browse notes, view the wikilink graph. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconFolderOpen16, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { VaultGraphData, VaultNote, VaultPanelFace } from './slots.ts'
import { runVaultGraph } from './graph.ts'
import css from './VaultPanel.module.css'

export type VaultPanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<VaultPanelFace> & PropsLocale<'vault'>

/** Render the Vault trigger and the upload/notes/graph panel it opens above the sidebar footer. */
export function VaultPanel({ wide, baseUrl, t }: VaultPanelProps) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<VaultGraphData>()
  const [loadError, setLoadError] = useState<string>()
  const [uploadStatus, setUploadStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect !== undefined) setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const load = (): void => {
    setLoadError(undefined)
    fetch(`${baseUrl}/vault/graph-data`)
      .then(res => res.json() as Promise<VaultGraphData>)
      .then(setData)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error))
      })
  }

  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!open || data === undefined || canvasRef.current === null) return
    return runVaultGraph(canvasRef.current, data.graph)
  }, [open, data])

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
    <div ref={rootRef} className={wide ? css.layer : `${css.layer} ${css.rail}`}>
      {open && anchor !== undefined && (
        <section className={css.panel} style={anchor} data-vault-panel aria-label={t('panel.title')}>
          <header className={css.header}>
            <span className={css.title}>{t('panel.title')}</span>
          </header>
          <div className={css.body}>
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

            {data !== undefined && data.graph.nodes.length > 0 && (
              <>
                <h3 className={css.group}>{t('panel.graph.title')}</h3>
                <canvas ref={canvasRef} className={css.graph} />
              </>
            )}

            <h3 className={css.group}>{t('panel.notes.count', { count: data?.notes.length ?? 0 })}</h3>
            {data !== undefined && data.notes.length === 0 && <p className={css.note}>{t('panel.notes.empty')}</p>}
            <ul className={css.rows}>{data?.notes.map(renderNote)}</ul>
          </div>
        </section>
      )}
      <div className={css.footerButtons}>
        <button
          type="button"
          className={css.badge}
          aria-label={t('panel.trigger')}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconFolderOpen16 size={wide ? 16 : 18} />
          {wide && <span className={css.badgeLabel}>{t('panel.trigger')}</span>}
        </button>
      </div>
    </div>
  )
}
