import { useEffect, useRef, useState } from 'react'
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const DEFAULT_SCALE = 0.85
const MIN_SCALE = 0.55
const MAX_SCALE = 1.75
const SCALE_STEP = 0.15

interface PdfPreviewProps {
  fileUrl: string
}

const clampScale = (nextScale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))

export function PdfPreview({ fileUrl }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    setScale(DEFAULT_SCALE)
    setPageNumber(1)
    setPageCount(0)
    setDocumentProxy(null)

    const loadingTask = getDocument({
      url: fileUrl,
      withCredentials: true,
    })
    let active = true

    void loadingTask.promise
      .then((pdfDocument) => {
        if (!active) {
          void pdfDocument.destroy()
          return
        }

        documentRef.current = pdfDocument
        setDocumentProxy(pdfDocument)
        setPageCount(pdfDocument.numPages)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setLoading(false)
        setError('PDF preview could not be loaded. Use download instead.')
      })

    return () => {
      active = false
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      void loadingTask.destroy()
      if (documentRef.current) {
        void documentRef.current.destroy()
        documentRef.current = null
      }
    }
  }, [fileUrl])

  useEffect(() => {
    if (!documentProxy) {
      return
    }

    let cancelled = false

    const renderPage = async () => {
      try {
        const page = await documentProxy.getPage(pageNumber)
        if (cancelled) {
          return
        }

        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) {
          throw new Error('canvas_unavailable')
        }

        const viewport = page.getViewport({ scale })
        const pixelRatio = window.devicePixelRatio || 1

        canvas.width = Math.floor(viewport.width * pixelRatio)
        canvas.height = Math.floor(viewport.height * pixelRatio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        renderTaskRef.current = renderTask
        await renderTask.promise

        if (cancelled) {
          return
        }

        setLoading(false)
        setError('')
      } catch (renderError) {
        if (cancelled) {
          return
        }

        const errorName = renderError instanceof Error ? renderError.name : ''
        if (errorName === 'RenderingCancelledException') {
          return
        }

        setLoading(false)
        setError('PDF preview could not be rendered. Use download instead.')
      }
    }

    setLoading(true)
    void renderPage()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [documentProxy, pageNumber, scale])

  const canGoPrevious = pageNumber > 1
  const canGoNext = pageNumber < pageCount

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-[color:var(--text-muted)]">
          {pageCount > 0 ? `Page ${pageNumber} of ${pageCount}` : 'Preparing document...'}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={!canGoPrevious || loading}
          >
            Previous
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            disabled={!canGoNext || loading}
          >
            Next
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setScale((current) => clampScale(current - SCALE_STEP))}
            disabled={scale <= MIN_SCALE || loading}
          >
            Zoom out
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setScale((current) => clampScale(current + SCALE_STEP))}
            disabled={scale >= MAX_SCALE || loading}
          >
            Zoom in
          </button>
        </div>
      </div>

      {loading && !error && (
        <div className="rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-3 text-sm text-[color:var(--text-muted)]">
          Loading PDF preview...
        </div>
      )}

      {error ? (
        <div className="rounded-[2px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="overflow-auto rounded-[2px] border border-[color:var(--border)] bg-slate-100 p-3">
          <canvas ref={canvasRef} className="mx-auto block bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]" />
        </div>
      )}
    </div>
  )
}