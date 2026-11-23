import type { Artifact, ArtifactType, Version } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Kbd } from '@akasha/ui/kbd'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { Code2, RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useSaveHumanVersionMutation } from '../../entities/artifact/queries'
import { fetchArtifactDetail, parseVersionConflictDetails } from '../../shared/api/client'
import { ConflictResolutionBanner, type EditorConflictState } from './ConflictResolutionBanner'

export interface SplitCodeEditorProps {
  artifact: Artifact
  version: Version
  /** 远端最新的版本；与 `version` 不同时提示冲突。 */
  latestVersion?: Version
  /** 分享编辑者可以保存版本，但不能向所有者的 CLI 投递变更摘要。 */
  notifyAgent?: boolean
  /** 草稿变化时通知父级更新右侧的沙盒预览；传 `null` 表示清除预览。 */
  onLivePreviewChange?: (source: string | null) => void
  // 测试或外层可注入自定义保存实现，默认调用 useSaveHumanVersionMutation（落盘 author=human + kind=edit 反馈）
  onSaveOverride?: (input: { source: string; baseVersion: number }) => Promise<{ version: Version }>
  onVersionSaved?: (version: Version) => void
  onVersionAdopted?: (version: Version) => void
}

function languageExtensionFor(type: ArtifactType, source: string): Extension {
  switch (type) {
    case 'react':
      return javascript({ jsx: true, typescript: true })
    case 'html':
    case 'svg':
      return html()
    case 'markdown':
    case 'mermaid':
      return markdown()
    case 'document':
      return source.trim().startsWith('{') ? json() : html()
    default:
      return json()
  }
}

/**
 * L3 的 CodeMirror 6 分栏代码编辑器。
 *
 * @remarks 草稿实时同步到右侧沙盒预览；Cmd/Ctrl+S 保存人类版本并写入一条 `kind=edit` 的反馈。
 * Agent 或协作者并发推送新版本、或保存触发 409 时，保留用户未保存的草稿，
 * 并展示双方的差异与合并入口。
 */
export function SplitCodeEditor({
  artifact,
  version,
  latestVersion,
  notifyAgent = true,
  onLivePreviewChange,
  onSaveOverride,
  onVersionSaved,
  onVersionAdopted,
}: SplitCodeEditorProps) {
  const hostRef = useRef<HTMLElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveMutation = useSaveHumanVersionMutation(artifact.publicId, notifyAgent)

  const [draftSource, setDraftSource] = useState(version.source)
  const [baseVersion, setBaseVersion] = useState(version.version)
  const [baseSource, setBaseSource] = useState(version.source)
  const [conflict, setConflict] = useState<EditorConflictState | null>(null)
  const [saving, setSaving] = useState(false)

  const isDirty = draftSource !== baseSource
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const savingRef = useRef(saving)
  savingRef.current = saving
  const draftSourceRef = useRef(draftSource)
  draftSourceRef.current = draftSource
  const baseVersionRef = useRef(baseVersion)
  baseVersionRef.current = baseVersion
  const baseSourceRef = useRef(baseSource)
  baseSourceRef.current = baseSource

  const effectiveLatest = latestVersion ?? version

  const replaceEditorDoc = useCallback((nextText: string) => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === nextText) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: nextText },
    })
  }, [])

  // 切换 Artifact 或远端版本更新时：未修改草稿则平滑同步最新源码；已修改则严禁覆盖草稿并展示并发冲突差异。
  const activeArtifactIdRef = useRef(artifact.publicId)
  useEffect(() => {
    if (activeArtifactIdRef.current !== artifact.publicId) {
      activeArtifactIdRef.current = artifact.publicId
      setDraftSource(version.source)
      setBaseVersion(version.version)
      setBaseSource(version.source)
      setConflict(null)
      replaceEditorDoc(version.source)
      onLivePreviewChange?.(null)
      return
    }

    if (version.version === baseVersionRef.current && version.source === baseSourceRef.current) {
      return
    }

    if (!isDirtyRef.current) {
      setDraftSource(version.source)
      setBaseVersion(version.version)
      setBaseSource(version.source)
      setConflict(null)
      replaceEditorDoc(version.source)
      return
    }

    if (version.version > baseVersionRef.current) {
      setConflict({
        reason: 'remote_updated',
        baseVersion: baseVersionRef.current,
        headVersion: version.version,
        authors: [version.author],
        remoteSource: version.source,
        localSource: draftSourceRef.current,
      })
    }
  }, [
    artifact.publicId,
    version.version,
    version.source,
    version.author,
    replaceEditorDoc,
    onLivePreviewChange,
  ])

  // 当用户编辑历史版本（落后于 headVersion）或编辑中远端推进时，立即提示并发版本差异
  useEffect(() => {
    if (
      latestVersion &&
      latestVersion.version > baseVersionRef.current &&
      isDirty &&
      (!conflict || conflict.headVersion < latestVersion.version)
    ) {
      setConflict({
        reason: 'remote_updated',
        baseVersion: baseVersionRef.current,
        headVersion: latestVersion.version,
        authors: [latestVersion.author],
        remoteSource: latestVersion.source,
        localSource: draftSourceRef.current,
      })
    }
  }, [latestVersion, isDirty, conflict])

  // 防抖通知父级更新右侧沙盒实时预览：只要编辑区内容与当前路由 version.source 不一致（含未保存草稿或历史路由下已加载 HEAD），均保持预览一致。
  useEffect(() => {
    if (!onLivePreviewChange) return
    if (draftSource === version.source) {
      onLivePreviewChange(null)
      return
    }
    const timer = setTimeout(() => {
      onLivePreviewChange(draftSource)
    }, 180)
    return () => clearTimeout(timer)
  }, [draftSource, version.source, onLivePreviewChange])

  useEffect(() => {
    return () => {
      onLivePreviewChange?.(null)
    }
  }, [onLivePreviewChange])

  const performSave = useCallback(
    async (explicitBaseVersion?: number) => {
      if (savingRef.current) return
      const targetBase = explicitBaseVersion ?? baseVersionRef.current
      const nextSource = draftSourceRef.current
      savingRef.current = true
      setSaving(true)
      try {
        const res = onSaveOverride
          ? await onSaveOverride({ source: nextSource, baseVersion: targetBase })
          : await saveMutation.mutateAsync({
              artifact,
              previousSource: baseSourceRef.current,
              source: nextSource,
              baseVersion: targetBase,
            })

        setBaseVersion(res.version.version)
        setBaseSource(res.version.source)
        setConflict(null)

        // 若保存请求在途期间用户继续编辑，只推进基线版本而不覆盖其新键入内容
        const editedWhileSaving = draftSourceRef.current !== nextSource
        if (!editedWhileSaving) {
          setDraftSource(res.version.source)
          replaceEditorDoc(res.version.source)
          onLivePreviewChange?.(res.version.source === version.source ? null : res.version.source)
        }
        toast.success(
          editedWhileSaving
            ? `已保存为 v${res.version.version}，已保留你在保存期间的新修改`
            : `已保存为 v${res.version.version}`,
        )
        onVersionSaved?.(res.version)
      } catch (err) {
        const details = parseVersionConflictDetails(err)
        if (details) {
          setConflict({
            reason: 'http_409',
            baseVersion: details.baseVersion,
            headVersion: details.headVersion,
            authors: details.authors,
            serverDiff: details.diff,
            remoteSource:
              effectiveLatest.version === details.headVersion ? effectiveLatest.source : undefined,
            localSource: draftSourceRef.current,
          })
          toast.error(`版本冲突（409）：远端已更新至 v${details.headVersion}，请先确认差异`)
        } else {
          toast.error(err instanceof Error ? err.message : '保存代码失败')
        }
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [
      artifact,
      effectiveLatest.source,
      effectiveLatest.version,
      onLivePreviewChange,
      onSaveOverride,
      onVersionSaved,
      replaceEditorDoc,
      saveMutation,
      version.source,
    ],
  )

  const performSaveRef = useRef(performSave)
  performSaveRef.current = performSave

  // 初始化 CodeMirror 6 编辑器实例（按 Artifact ID 与类型重建语言高亮）
  useEffect(() => {
    void artifact.publicId
    const parent = hostRef.current
    if (!parent) return

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          if (isDirtyRef.current) {
            void performSaveRef.current()
          }
          return true
        },
      },
    ])

    const state = EditorState.create({
      doc: draftSourceRef.current,
      extensions: [
        basicSetup,
        languageExtensionFor(artifact.type, draftSourceRef.current),
        saveKeymap,
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px', backgroundColor: 'transparent' },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            overflow: 'auto',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: '1px solid var(--color-border, #e2e8f0)',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            setDraftSource(text)
            setConflict((prev) => (prev ? { ...prev, localSource: text } : prev))
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [artifact.publicId, artifact.type])

  const handleDiscard = () => {
    setDraftSource(baseSource)
    setConflict(null)
    replaceEditorDoc(baseSource)
    onLivePreviewChange?.(null)
  }

  const handleAdoptLatest = async () => {
    let target = effectiveLatest
    // 若触发 409 时本地版本缓存尚未刷新到最新 headVersion，则主动向服务端拉取最新版本源码
    if (conflict && target.version < conflict.headVersion) {
      try {
        const fresh = await fetchArtifactDetail(artifact.publicId)
        target = fresh.version
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '拉取最新版本失败')
        return
      }
    }
    setBaseVersion(target.version)
    setBaseSource(target.source)
    setDraftSource(target.source)
    setConflict(null)
    replaceEditorDoc(target.source)
    // 立即将最新源码同步到相邻预览，并通知外层路由从历史版本切换回 HEAD
    onLivePreviewChange?.(target.source === version.source ? null : target.source)
    onVersionAdopted?.(target)
    toast.success(`已加载最新 v${target.version}`)
  }

  return (
    <div
      data-testid="l3-code-editor"
      className="flex h-full min-h-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <Code2 size={14} className="text-ink-muted" />
          <span className="font-semibold text-ink">L3 代码编辑</span>
          <Badge tone="neutral">基线 v{baseVersion}</Badge>
          {isDirty ? <Badge tone="warning">未保存</Badge> : <Badge tone="ok">已同步</Badge>}
        </div>

        <div className="flex items-center gap-1.5">
          {isDirty ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw size={12} />}
              disabled={saving}
              onClick={handleDiscard}
            >
              还原修改
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save size={12} />}
            disabled={!isDirty}
            loading={saving}
            onClick={() => void performSave()}
          >
            保存为新版本
            <span className="ml-1 opacity-80">
              <Kbd size="sm" keys={['mod', 'S']} />
            </span>
          </Button>
        </div>
      </div>

      {conflict ? (
        <ConflictResolutionBanner
          conflict={conflict}
          saving={saving}
          onAdoptLatest={() => void handleAdoptLatest()}
          onSaveMerged={() => void performSave(conflict.headVersion)}
          onDismiss={() => setConflict(null)}
        />
      ) : null}

      <section ref={hostRef} className="min-h-0 flex-1 overflow-hidden" aria-label="代码编辑区" />
    </div>
  )
}
