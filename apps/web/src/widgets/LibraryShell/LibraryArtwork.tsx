import type { Artifact } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { fetchArtifactDetail } from '../../shared/api/client'
import { captureBoardPng } from '../../shared/bridge/capture-png'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'
import { createCanvasDocument } from '../ArtifactWorkspace/canvas-model'

const PREVIEW_EDGE = 480

function previewKey(artifactId: string, version: number) {
  return ['artifact-thumbnail', artifactId, version] as const
}

/** 封面只读该版本的授权源码；无结果时保留标题和类型。 */
export function LibraryArtwork({ artifact }: { artifact: Artifact }) {
  const { publicId, headVersion, title, type } = artifact
  const target = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [image, setImage] = useState<{ png: Blob; url: string } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const client = useQueryClient()
  const preview = useQuery({
    queryKey: previewKey(publicId, headVersion),
    enabled: visible && Boolean(navigator.locks),
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const { artifact: current, version } = await fetchArtifactDetail(
        publicId,
        headVersion,
        signal,
      )
      if (version.version !== headVersion || version.artifactId !== publicId) {
        throw new Error('缩略图必须来自卡片指定的版本')
      }
      const document = createCanvasDocument(
        current.type,
        version.title,
        version.source,
        version.version,
        null,
      )
      const board = document.pages.find((page) => page.boards.length > 0)?.boards[0]
      if (!board) throw new Error('该版本没有画板')
      const scale = Math.min(1, PREVIEW_EDGE / Math.max(board.width, board.height))
      return captureBoardPng(board, version.version, scale, signal)
    },
  })
  useEffect(() => {
    const frame = target.current
    if (!frame || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      const onscreen = entry?.isIntersecting === true
      setVisible(onscreen)
      if (!onscreen)
        void client.cancelQueries({ queryKey: previewKey(publicId, headVersion), exact: true })
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [client, headVersion, publicId])
  useEffect(() => {
    const png = preview.data
    if (!png) return
    const url = URL.createObjectURL(png)
    setImage({ png, url })
    return () => URL.revokeObjectURL(url)
  }, [preview.data])

  const url = image && image.png === preview.data && image.url !== broken ? image.url : undefined
  const label = (
    <>
      <h2 className="line-clamp-2 min-w-0 break-words text-sm font-semibold">{title}</h2>
      <Badge tone="neutral">{ARTIFACT_TYPE_LABELS[type]}</Badge>
    </>
  )

  return (
    <div ref={target} className="w-full">
      <div className="aspect-[16/10] overflow-hidden rounded-md bg-surface-subtle">
        {url ? (
          <img
            src={url}
            alt=""
            className="h-full w-full object-contain"
            onError={() => setBroken(url)}
          />
        ) : (
          <div className="flex h-full flex-col items-start justify-center gap-2 px-4">{label}</div>
        )}
      </div>
      <div className="flex min-h-8 items-center justify-between gap-2 pt-2">
        {url ? label : null}
      </div>
    </div>
  )
}
