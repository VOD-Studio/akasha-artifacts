import type { Artifact, Project } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import {
  CardFrame,
  CardFrameBody,
  CardFrameImage,
  CardFrameMeta,
  CardFrameTitle,
} from '@akasha/ui/card'
import { Empty } from '@akasha/ui/empty'
import { Skeleton } from '@akasha/ui/skeleton'
import { Star } from 'lucide-react'
import type { MouseEventHandler } from 'react'
import { ARTIFACT_TYPE_LABELS, formatRelativeTime } from '@/shared/lib/format'
import { LibraryArtwork } from './LibraryArtwork'

const CARD_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
const CARD_SURFACE = 'rounded-xl border border-border bg-surface'
const LOADING_ITEMS = [0, 1, 2, 3, 4, 5]

interface LibraryResultsProps {
  artifacts: readonly Artifact[]
  projects: ReadonlyMap<string, Project>
  favorites: ReadonlySet<string> | null
  cards: boolean
  /** 未筛选的库内存在制品时，空结果可以通过清除筛选恢复。 */
  hasArtifacts: boolean
  cloudHub: boolean
  onResetFilters: () => void
  onOpenArtifact: (publicId: string) => void
}

/** 普通点击留在工作台路由内，制品链接也可在新标签页打开。 */
export function LibraryResults({
  artifacts,
  projects,
  favorites,
  cards,
  hasArtifacts,
  cloudHub,
  onResetFilters,
  onOpenArtifact,
}: LibraryResultsProps) {
  if (!hasArtifacts) {
    if (cloudHub) return <Empty variant="plain" title="没有可访问的作品" />
    return (
      <Empty
        variant="plain"
        title="还没有作品"
        action={
          <Button asChild size="sm" variant="ghost">
            <a
              href="https://github.com/VOD-Studio/akasha-artifacts/blob/main/README.zh-CN.md#1-接入你的编程-agentmcp-与-hooks--m1m2"
              target="_blank"
              rel="noreferrer"
            >
              接入 Agent
            </a>
          </Button>
        }
      />
    )
  }
  if (!artifacts.length) {
    return (
      <Empty
        variant="plain"
        title="未找到作品"
        action={
          <Button size="sm" variant="outline" onClick={onResetFilters}>
            清除筛选
          </Button>
        }
      />
    )
  }

  return (
    <ul className={cards ? CARD_GRID : 'divide-y divide-border'}>
      {artifacts.map((artifact) => (
        <li key={artifact.publicId} className="min-w-0">
          <LibraryEntry
            artifact={artifact}
            projectName={projects.get(artifact.projectId)?.name}
            favorite={favorites?.has(artifact.publicId) === true}
            cards={cards}
            onOpenArtifact={onOpenArtifact}
          />
        </li>
      ))}
    </ul>
  )
}

/** 用真实结果的网格或列表尺寸占位，不创建可聚焦的空卡。 */
export function LibraryLoading({ cards }: { cards: boolean }) {
  if (!cards) {
    return (
      <div className="divide-y divide-border">
        {LOADING_ITEMS.map((item) => (
          <div key={item} className="px-2 py-3">
            <Skeleton className="h-5 w-2/5" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={CARD_GRID}>
      {LOADING_ITEMS.map((item) => (
        <CardFrame key={item} className={CARD_SURFACE}>
          <CardFrameImage>
            <Skeleton className="size-full" />
          </CardFrameImage>
          <CardFrameBody>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-3/5" />
          </CardFrameBody>
        </CardFrame>
      ))}
    </div>
  )
}

interface LibraryEntryProps {
  artifact: Artifact
  projectName?: string
  favorite: boolean
  cards: boolean
  onOpenArtifact: (publicId: string) => void
}

function LibraryEntry({
  artifact,
  projectName,
  favorite,
  cards,
  onOpenArtifact,
}: LibraryEntryProps) {
  const openArtifact: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpenArtifact(artifact.publicId)
  }
  const href = `/a/${encodeURIComponent(artifact.publicId)}`
  const type = ARTIFACT_TYPE_LABELS[artifact.type]
  const metadata = (
    <>
      {favorite && <Star size={12} aria-label="已收藏" />}
      <bdi className="min-w-0 wrap-break-word">{projectName ?? '其他项目'}</bdi>
      <time dateTime={artifact.updatedAt}>{formatRelativeTime(artifact.updatedAt)}</time>
    </>
  )
  if (cards) {
    return (
      <CardFrame className={`h-full ${CARD_SURFACE}`}>
        <LibraryArtwork artifact={artifact} />
        <CardFrameBody>
          <CardFrameTitle asChild>
            <a href={href} className="wrap-break-word" dir="auto" onClick={openArtifact}>
              {artifact.title}
            </a>
          </CardFrameTitle>
          <CardFrameMeta className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{type}</span>
            {metadata}
          </CardFrameMeta>
        </CardFrameBody>
      </CardFrame>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-xs text-ink-muted">
      <a
        href={href}
        dir="auto"
        className="min-w-0 flex-1 wrap-break-word rounded text-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={openArtifact}
      >
        {artifact.title}
      </a>
      <Badge tone="neutral">{type}</Badge>
      {metadata}
      <span dir="ltr" className="wrap-break-word">
        {artifact.slug} · v{artifact.headVersion}
      </span>
    </div>
  )
}
