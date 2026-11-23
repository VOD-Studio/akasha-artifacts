import type { Artifact, Version } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@akasha/ui/tabs'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { PropsPanel } from '../../features/props-panel/PropsPanel'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'
import type { CanvasDocument, CanvasLocation } from './canvas-model'

interface BoardInspectorProps {
  artifact: Artifact
  version: Version
  stateSnapshot: Record<string, unknown>
  document: CanvasDocument
  location: CanvasLocation | null
  readOnly: boolean
  onNavigate: (location: CanvasLocation) => void
}

const EMPTY_PROPS: Record<string, unknown> = {}

/** 检查器与批注独立；这里只读当前快照，调参另走制品状态流。 */
export function BoardInspector({
  artifact,
  version,
  stateSnapshot,
  document,
  location,
  readOnly,
  onNavigate,
}: BoardInspectorProps) {
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const setDrawer = useWorkspaceStore((state) => state.setInspectorTab)
  const page = document.pages.find((item) => item.id === location?.pageId)
  const board = page?.boards.find((item) => item.id === location?.boardId)
  const source = board && !board.generated ? board.source : version.source

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setDrawer(next ? 'inspect' : null)}>
      <SheetContent
        id="design-inspector"
        size="sm"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className="top-13 bottom-0 overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>检查器</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-4">
            <section aria-label="页面与画板树" className="border-b border-border pb-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                <h2>画板</h2>
                <Badge tone="neutral">v{version.version}</Badge>
              </div>
              <div className="max-h-48 space-y-1 overflow-auto">
                {document.pages.map((entry) => (
                  <details key={entry.id} open={entry.id === page?.id || undefined}>
                    <summary className="cursor-pointer rounded px-2 py-1 text-sm text-ink">
                      {entry.title}
                    </summary>
                    {entry.boards.length ? (
                      <ul className="ml-3 border-l border-border pl-2">
                        {entry.boards.map((item) => {
                          const current = entry.id === page?.id && item.id === board?.id
                          return (
                            <li key={item.id}>
                              <Button
                                variant={current ? 'secondary' : 'ghost'}
                                size="sm"
                                className="w-full justify-start"
                                aria-pressed={current}
                                onClick={() => onNavigate({ pageId: entry.id, boardId: item.id })}
                              >
                                <span className="truncate">{item.title}</span>
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="px-4 py-1 text-xs text-ink-muted">此页面没有画板</p>
                    )}
                  </details>
                ))}
              </div>
            </section>
            {readOnly ? <p className="text-xs text-ink-muted">历史版本 · 只读</p> : null}
            <Tabs defaultValue="properties">
              <TabsList aria-label="检查对象信息">
                <TabsTrigger value="properties">属性</TabsTrigger>
                <TabsTrigger value="source">源码</TabsTrigger>
                <TabsTrigger value="runtime">调参</TabsTrigger>
              </TabsList>
              <TabsContent value="properties" className="pt-3">
                {board ? (
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-ink-muted">页面</dt>
                    <dd>{page?.title}</dd>
                    <dt className="text-ink-muted">画板</dt>
                    <dd>{board.title}</dd>
                    <dt className="text-ink-muted">视口</dt>
                    <dd>
                      {board.width} × {board.height}
                    </dd>
                    <dt className="text-ink-muted">内容</dt>
                    <dd>{ARTIFACT_TYPE_LABELS[board.type]}</dd>
                  </dl>
                ) : (
                  <p className="py-2 text-sm text-ink-muted">从树中选择画板以查看属性</p>
                )}
              </TabsContent>
              <TabsContent value="source" className="space-y-2 pt-3">
                <p className="text-xs text-ink-muted">
                  {board && !board.generated ? '当前画板的源码' : '当前版本的制品源码'}
                </p>
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
                  <code>{source}</code>
                </pre>
              </TabsContent>
              <TabsContent value="runtime" className="space-y-2 pt-3">
                <p className="text-xs text-ink-muted">运行参数只更新状态流，不写入设计版本。</p>
                <PropsPanel
                  artifactId={artifact.publicId}
                  projectId={artifact.projectId}
                  artifactType={artifact.type}
                  source={version.source}
                  stateSnapshot={readOnly ? EMPTY_PROPS : stateSnapshot}
                  readOnly={readOnly}
                  onFallbackToL1={() => setDrawer('review')}
                />
              </TabsContent>
            </Tabs>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
