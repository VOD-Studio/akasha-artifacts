import type { Artifact } from '@akasha/protocol'
import { CardFrameImage } from '@akasha/ui/card'
import { Skeleton } from '@akasha/ui/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchArtifactDetail } from '../../shared/api/client'
import { captureBoardPng } from '../../shared/bridge/capture-png'
import { createCanvasDocument } from '../ArtifactWorkspace/canvas-model'

const PREVIEW_EDGE = 480

function previewKey(artifactId: string, version: number) {
  return ['artifact-thumbnail', artifactId, version] as const
}

/** 只为出现在视口的卡片读取授权版本；拿不到缩略时不替作品生成内容。 */
export function LibraryArtwork({ artifact }: { artifact: Artifact }) {
  const { publicId, headVersion } = artifact
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
  const markImageBroken = () => {
    if (url) setBroken(url)
  }

  const loading = !url && preview.isFetching
  return (
    <CardFrameImage ref={target}>
      {url && <img src={url} alt="" className="object-contain" onError={markImageBroken} />}
      {loading && <Skeleton className="size-full" />}
      {!url && !loading && (
        <div className="grid size-full place-items-center text-ink-muted" aria-hidden="true">
          <FileText className="size-7" strokeWidth={1.5} />
        </div>
      )}
    </CardFrameImage>
  )
}
