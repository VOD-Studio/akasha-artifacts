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
import { Check, Copy, Star, Terminal } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { toast } from 'sonner'
import { useSetArtifactFavoriteMutation } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'
import { hubArtifactPath } from '@/shared/config/hub-artifact'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel, formatRelativeTime } from '@/shared/lib/format'
import { messages } from '../messages'
import { LibraryArtwork } from './LibraryArtwork'

const CARD_GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'
const LOADING_ITEMS = [0, 1, 2, 3, 4, 5]
const CONNECT_COMMAND = 'akasha agent connect --project .'

interface LibraryResultsProps {
  artifacts: readonly Artifact[]
  projects: ReadonlyMap<string, Project>
  favorites: ReadonlySet<string> | null
  cards: boolean
  /** 未筛选的库内存在制品时，空结果可以通过清除筛选恢复。 */
  hasArtifacts: boolean
  cloudHub: boolean
  onCreate?: () => void
  onResetFilters: () => void
  onOpenArtifact: (publicId: string, destination?: 'hub') => void
}

/** 普通点击留在工作台路由内，制品链接也可在新标签页打开。 */
export function LibraryResults({
  artifacts,
  projects,
  favorites,
  cards,
  hasArtifacts,
  cloudHub,
  onCreate,
  onResetFilters,
  onOpenArtifact,
}: LibraryResultsProps) {
  const { t } = useMessages(messages)
  const [copiedCmd, setCopiedCmd] = useState(false)

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(CONNECT_COMMAND)
      setCopiedCmd(true)
      toast.success(t('已复制命令'))
      window.setTimeout(() => setCopiedCmd(false), 1800)
    } catch {
      toast.error(t('无法写入剪贴板'))
    }
  }

  if (!hasArtifacts) {
    if (cloudHub) {
      return (
        <div className="py-16">
          <Empty variant="plain" title={t('没有可访问的作品')} />
        </div>
      )
    }
    return (
      <div className="mx-auto my-10 max-w-md rounded-12 border border-border bg-surface px-6 py-10">
        <Empty
          variant="default"
          illustration={<AkashaMark size={28} className="text-ink" />}
          title={t('还没有作品')}
          description={t('在终端连接 Agent 后，发布的作品会实时显示在这里')}
          action={
            onCreate && (
              <Button variant="primary" size="sm" onClick={onCreate}>
                {t('新建设计')}
              </Button>
            )
          }
        />
        <div className="mt-6 flex items-center justify-between gap-2 rounded-8 border border-border bg-canvas px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-ink">
            <Terminal size={14} aria-hidden="true" className="shrink-0 text-ink-muted" />
            <code dir="ltr" className="truncate select-all">
              {CONNECT_COMMAND}
            </code>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('复制命令')}
            title={t('复制命令')}
            onClick={() => void copyCommand()}
          >
            {copiedCmd ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </Button>
        </div>
      </div>
    )
  }

  if (!artifacts.length) {
    return (
      <div className="py-16">
        <Empty
          variant="plain"
          title={t('未找到作品')}
          action={
            <Button size="sm" variant="outline" onClick={onResetFilters}>
              {t('清除筛选')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <ul className={cards ? CARD_GRID : 'divide-y divide-border border-y border-border'}>
      {artifacts.map((artifact) => (
        <li key={artifact.publicId} className="min-w-0">
          <LibraryEntry
            artifact={artifact}
            projectName={projects.get(artifact.projectId)?.name}
            favorite={favorites?.has(artifact.publicId) === true}
            favoritesAvailable={favorites !== null}
            cards={cards}
            cloudHub={cloudHub}
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
      <div className="divide-y divide-border border-y border-border" aria-hidden="true">
        {LOADING_ITEMS.map((item) => (
          <div key={item} className="flex items-center gap-3 px-2 py-3.5">
            <Skeleton className="h-9 w-14 shrink-0 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={CARD_GRID} aria-hidden="true">
      {LOADING_ITEMS.map((item) => (
        <CardFrame key={item}>
          <CardFrameImage>
            <Skeleton className="size-full rounded-none" />
          </CardFrameImage>
          <CardFrameBody>
            <CardFrameTitle>
              <Skeleton className="h-lh w-3/5" />
            </CardFrameTitle>
            <CardFrameMeta>
              <Skeleton className="h-lh w-2/5" />
            </CardFrameMeta>
          </CardFrameBody>
        </CardFrame>
      ))}
    </div>
  )
}

interface FavoriteActionProps {
  artifactId: string
  favorite: boolean
  alwaysVisible?: boolean
  compact?: boolean
}

function FavoriteAction({
  artifactId,
  favorite,
  alwaysVisible = false,
  compact = false,
}: FavoriteActionProps) {
  const { t } = useMessages(messages)
  const setFavorite = useSetArtifactFavoriteMutation(artifactId)
  const label = favorite ? t('取消收藏') : t('添加收藏')
  const toggle = () => {
    setFavorite.mutate(!favorite, {
      onSuccess: ({ favorite: saved }) => toast.success(t(saved ? '已收藏' : '已取消收藏')),
      onError: (error) => toast.error(getRequestErrorMessage(error)),
    })
  }
  const visibilityClass =
    alwaysVisible || favorite
      ? 'opacity-100'
      : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      disabled={setFavorite.isPending}
      aria-label={label}
      aria-pressed={favorite}
      title={label}
      onClick={toggle}
      className={compact ? `size-7 ${visibilityClass}` : visibilityClass}
    >
      <Star size={compact ? 13 : 14} className={favorite ? 'fill-current text-ink' : ''} />
    </Button>
  )
}

interface LibraryEntryProps {
  artifact: Artifact
  projectName?: string
  favorite: boolean
  favoritesAvailable: boolean
  cards: boolean
  cloudHub: boolean
  onOpenArtifact: LibraryResultsProps['onOpenArtifact']
}

function LibraryEntry({
  artifact,
  projectName,
  favorite,
  favoritesAvailable,
  cards,
  cloudHub,
  onOpenArtifact,
}: LibraryEntryProps) {
  const { t, locale } = useMessages(messages)
  const [copied, setCopied] = useState(false)

  const openArtifact = (event: MouseEvent<HTMLAnchorElement>, destination?: 'hub') => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpenArtifact(artifact.publicId, destination)
  }

  const copyLink = async () => {
    try {
      const path = `/a/${encodeURIComponent(artifact.publicId)}`
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href)
      setCopied(true)
      toast.success(t('已复制链接'))
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('无法写入剪贴板'))
    }
  }

  const href = `/a/${encodeURIComponent(artifact.publicId)}`
  const type = artifactTypeLabel(artifact.type, locale)
  const projectLabel = projectName ?? t('其他项目')
  const updatedText = formatRelativeTime(artifact.updatedAt, undefined, locale)

  if (cards) {
    return (
      <CardFrame className="group h-full">
        <div className="relative">
          <LibraryArtwork artifact={artifact} />
          <div className="absolute inset-e-2.5 top-2.5 z-2 flex items-center gap-1">
            {favoritesAvailable && (
              <div
                className={`rounded-full bg-surface/85 ring-1 ring-ink/8 backdrop-blur-md transition-opacity ${
                  favorite
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                }`}
              >
                <FavoriteAction
                  artifactId={artifact.publicId}
                  favorite={favorite}
                  alwaysVisible
                  compact
                />
              </div>
            )}
            <div className="rounded-full bg-surface/85 opacity-0 ring-1 ring-ink/8 backdrop-blur-md transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                className="size-7"
                aria-label={t('复制链接')}
                title={t('复制链接')}
                onClick={() => void copyLink()}
              >
                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              </Button>
            </div>
          </div>
        </div>
        <CardFrameBody>
          <div className="flex items-baseline justify-between gap-2">
            <CardFrameTitle asChild>
              <a
                href={href}
                className="min-w-0 flex-1 truncate"
                dir="auto"
                title={artifact.title}
                onClick={openArtifact}
              >
                {artifact.title}
              </a>
            </CardFrameTitle>
            <span dir="ltr" className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">
              v{artifact.headVersion}
            </span>
          </div>
          <CardFrameMeta className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{type}</span>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <bdi className="min-w-0 truncate">{projectLabel}</bdi>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <time dateTime={artifact.updatedAt} className="shrink-0 tabular-nums">
              <bdi>{updatedText}</bdi>
            </time>
            {cloudHub && (
              <Button asChild size="sm" variant="ghost" className="ms-auto">
                <a
                  href={hubArtifactPath(artifact.publicId)}
                  aria-label={t('在 Hub 打开：{title}', { title: artifact.title })}
                  onClick={(event) => openArtifact(event, 'hub')}
                >
                  {t('在 Hub 打开')}
                </a>
              </Button>
            )}
          </CardFrameMeta>
        </CardFrameBody>
      </CardFrame>
    )
  }

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-8 px-2 py-3 text-xs text-ink-muted transition-colors hover:bg-surface">
      <div className="h-9 w-14 shrink-0 overflow-hidden rounded-4 border border-border">
        <LibraryArtwork artifact={artifact} compact />
      </div>
      <div className="min-w-0 flex-1">
        <a
          href={href}
          dir="auto"
          className="block truncate rounded text-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={openArtifact}
        >
          {artifact.title}
        </a>
        <span dir="ltr" className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
          {artifact.slug}
        </span>
      </div>
      <Badge tone="neutral">{type}</Badge>
      <bdi className="hidden max-w-36 truncate sm:inline">{projectLabel}</bdi>
      <span dir="ltr" className="font-mono tabular-nums">
        v{artifact.headVersion}
      </span>
      <time dateTime={artifact.updatedAt} className="shrink-0 tabular-nums">
        <bdi>{updatedText}</bdi>
      </time>
      {cloudHub && (
        <Button asChild size="sm" variant="ghost">
          <a
            href={hubArtifactPath(artifact.publicId)}
            aria-label={t('在 Hub 打开：{title}', { title: artifact.title })}
            onClick={(event) => openArtifact(event, 'hub')}
          >
            {t('在 Hub 打开')}
          </a>
        </Button>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {favoritesAvailable && (
          <FavoriteAction artifactId={artifact.publicId} favorite={favorite} />
        )}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('复制链接')}
          title={t('复制链接')}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void copyLink()}
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </Button>
      </div>
    </div>
  )
}
