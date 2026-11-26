import type { DesignSystemDraft } from '@akasha/protocol'

type SourceFile = DesignSystemDraft['files'][number]
export type ComponentEntry = DesignSystemDraft['components'][number]

export function emptyDraft(): DesignSystemDraft {
  return {
    origin: { kind: 'local', label: '' },
    files: [],
    components: [],
    guidance: { instructions: '', fontFamily: 'system-ui', color: '#171717', spacing: 16 },
  }
}

export function componentKey(component: Pick<ComponentEntry, 'path' | 'exportName'>) {
  return `${component.path}#${component.exportName}`
}

/** 重选替换文件集合，不覆盖使用说明；手填的设计链接不参与本机文件的缺失判定。 */
export function importFiles(
  draft: DesignSystemDraft,
  incoming: SourceFile[],
  replace: boolean,
): DesignSystemDraft {
  const keep = replace
    ? draft.files.filter((file) => file.kind === 'figma' && file.content.startsWith('https://'))
    : draft.files
  const files = new Map(keep.map((file) => [file.path, file]))
  for (const file of incoming) files.set(file.path, file)
  return {
    ...draft,
    files: Array.from(files.values()),
    components: draft.components.filter((component) => files.has(component.path)),
  }
}

/** 保留组件时一并恢复其入口文件，不能产生悬空组件。 */
export function restoreItem(
  draft: DesignSystemDraft,
  previous: DesignSystemDraft,
  key: string,
): DesignSystemDraft {
  const component = previous.components.find((entry) => `component:${componentKey(entry)}` === key)
  const file = previous.files.find(
    (entry) => `file:${entry.path}` === key || entry.path === component?.path,
  )
  const files =
    file && !draft.files.some((entry) => entry.path === file.path)
      ? [...draft.files, file]
      : draft.files
  return {
    ...draft,
    files,
    components: component ? [...draft.components, component] : draft.components,
  }
}
