import type { ArtifactType, EditOp } from '@akasha/protocol'
import { collectHtmlTargets } from './edit-html.js'
import { collectJsxTargets } from './edit-jsx.js'

export interface VisualTarget {
  tagName: string
  text: string | null
  className: string
  order: {
    parentLoc: string
    siblings: Array<{ loc: string; label: string }>
  } | null
}

export interface SourcePatch {
  start: number
  end: number
  replacement: string
}

export interface LiteralTarget {
  loc: string
  tagName: string
  start: number
  end: number
  text: { value: string; patch: (value: string) => SourcePatch } | null
  className: string
  attribute: (name: string, value: string | null) => SourcePatch | null
  removal: string
  parentLoc?: string
  children?: LiteralTarget[]
}

export class VisualEditError extends Error {}

function collectTargets(type: ArtifactType, source: string): Map<string, LiteralTarget> {
  try {
    if (type === 'react') return collectJsxTargets(source)
    if (type === 'html') return collectHtmlTargets(source)
  } catch {
    // 不完整源码不能从位置推断改写目标，应交回批注。
  }
  return new Map()
}

export function inspectVisualTarget(
  type: ArtifactType,
  source: string,
  loc: string,
): VisualTarget | null {
  const targets = collectTargets(type, source)
  const node = targets.get(loc)
  if (!node) return null
  const siblings = node.parentLoc ? targets.get(node.parentLoc)?.children : undefined
  return {
    tagName: node.tagName,
    text: node.text?.value ?? null,
    className: node.className,
    order:
      node.parentLoc && siblings && siblings.length > 1
        ? {
            parentLoc: node.parentLoc,
            siblings: siblings.map((sibling) => ({
              loc: sibling.loc,
              label: sibling.text?.value.trim().slice(0, 80) || `<${sibling.tagName}>`,
            })),
          }
        : null,
  }
}

export function applyVisualEdit(type: ArtifactType, source: string, op: EditOp): string {
  const targets = collectTargets(type, source)
  const node = targets.get(op.loc)
  if (!node) throw new VisualEditError('该位置不是可直改的静态元素，请改用批注')
  let patches: SourcePatch[]
  switch (op.kind) {
    case 'text':
      if (!node.text) throw new VisualEditError('该元素没有可编辑的字面量文字，请改用批注')
      if (op.value === node.text.value) return source
      patches = [node.text.patch(op.value)]
      break
    case 'className': {
      if (op.value === node.className) return source
      const patch = node.attribute(type === 'html' ? 'class' : 'className', op.value)
      patches = patch ? [patch] : []
      break
    }
    case 'attr': {
      if (
        !/^(?:title|id|role|(?:aria|data)-[a-z0-9_-]+)$/.test(op.name) ||
        op.name.startsWith('data-ak-')
      ) {
        throw new VisualEditError('该属性不支持直改')
      }
      const patch = node.attribute(op.name, op.value)
      patches = patch ? [patch] : []
      break
    }
    case 'remove':
      patches = [{ start: node.start, end: node.end, replacement: node.removal }]
      break
    case 'move': {
      const siblings =
        node.parentLoc === op.targetParentLoc
          ? targets.get(op.targetParentLoc)?.children
          : undefined
      const from = siblings?.indexOf(node) ?? -1
      if (!siblings || from < 0 || op.index >= siblings.length) {
        throw new VisualEditError('只能在同一静态父元素下调整兄弟顺序')
      }
      if (from === op.index) return source
      const ordered = [...siblings]
      ordered.splice(from, 1)
      ordered.splice(op.index, 0, node)
      patches = []
      // 保留原槽位之间的缩进、空白和注释，仅交换节点自身的源码。
      for (let i = Math.min(from, op.index); i <= Math.max(from, op.index); i++) {
        const before = siblings[i]
        const after = ordered[i]
        if (!before || !after) continue
        patches.push({
          start: before.start,
          end: before.end,
          replacement: source.slice(after.start, after.end),
        })
      }
      break
    }
  }
  let result = source
  for (const patch of patches.reverse()) {
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end)
  }
  return result
}
