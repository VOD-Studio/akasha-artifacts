import { parse } from '@babel/parser'
import {
  applyInsertions,
  type BlockEntry,
  type InjectedLocationEntry,
  type InjectLocationsResult,
  type StringInsertion,
} from './types.js'

interface AstNode {
  type?: string
  start?: number | null
  end?: number | null
  loc?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  } | null
  [key: string]: unknown
}

function getJsxTagName(nameNode: AstNode | undefined): string | null {
  if (!nameNode) return null
  if (nameNode.type === 'JSXIdentifier' && typeof nameNode.name === 'string') {
    return nameNode.name
  }
  if (nameNode.type === 'JSXMemberExpression') {
    const obj = getJsxTagName(nameNode.object as AstNode | undefined)
    const prop = getJsxTagName(nameNode.property as AstNode | undefined)
    return obj && prop ? `${obj}.${prop}` : null
  }
  if (nameNode.type === 'JSXNamespacedName') {
    const ns = getJsxTagName(nameNode.namespace as AstNode | undefined)
    const name = getJsxTagName(nameNode.name as AstNode | undefined)
    return ns && name ? `${ns}:${name}` : null
  }
  return null
}

function isIntrinsicTag(tagName: string): boolean {
  // 仅向原生小写 HTML/SVG 标签注入 data-ak-loc，避免向 React.Fragment 或第三方组件透传非法属性。
  return /^[a-z]/.test(tagName)
}

function readStaticJsxAttr(opening: AstNode, attrName: string): string | undefined {
  const attrs = opening.attributes
  if (!Array.isArray(attrs)) return undefined
  for (const raw of attrs) {
    const attr = raw as AstNode
    if (attr.type !== 'JSXAttribute') continue
    const name = attr.name as AstNode | undefined
    if (name?.type !== 'JSXIdentifier' || name.name !== attrName) continue
    const value = attr.value as AstNode | null | undefined
    if (value?.type === 'StringLiteral' && typeof value.value === 'string') {
      return value.value
    }
    if (value?.type === 'JSXExpressionContainer') {
      const expr = value.expression as AstNode | undefined
      if (expr?.type === 'StringLiteral' && typeof expr.value === 'string') {
        return expr.value
      }
    }
  }
  return undefined
}

function hasJsxAttr(opening: AstNode, attrName: string): boolean {
  const attrs = opening.attributes
  if (!Array.isArray(attrs)) return false
  return attrs.some((raw) => {
    const attr = raw as AstNode
    if (attr.type !== 'JSXAttribute') return false
    const name = attr.name as AstNode | undefined
    return name?.type === 'JSXIdentifier' && name.name === attrName
  })
}

function isDynamicContainer(node: AstNode): boolean {
  // .map(...) / .flatMap(...) 等循环调用生成的节点标记为 dynamic，便于区分静态改写与动态节点
  if (node.type === 'CallExpression') {
    const callee = node.callee as AstNode | undefined
    if (callee?.type === 'MemberExpression') {
      const prop = callee.property as AstNode | undefined
      if (
        prop?.type === 'Identifier' &&
        (prop.name === 'map' || prop.name === 'flatMap' || prop.name === 'reduce')
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * 解析 TSX/JSX，为原生元素注入 `data-ak-loc="line:col"`，并提取稳定块标识。
 *
 * @remarks 行列均从 1 起。只向小写开头的原生标签注入，避免把非法属性透传给 React.Fragment
 * 或第三方组件。位于 `.map` 等循环内的元素额外标上 `data-ak-dynamic`。
 */
export function injectJsxLocations(source: string): InjectLocationsResult {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
  }) as unknown as AstNode

  const insertions: StringInsertion[] = []
  const locations: InjectedLocationEntry[] = []
  const blocks: BlockEntry[] = []

  const walk = (node: unknown, inDynamicLoop: boolean): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inDynamicLoop)
      return
    }
    const n = node as AstNode
    const nextDynamic = inDynamicLoop || isDynamicContainer(n)

    if (n.type === 'JSXOpeningElement') {
      const nameNode = n.name as AstNode | undefined
      const tagName = getJsxTagName(nameNode)
      const locStart = n.loc?.start
      if (tagName && locStart && typeof nameNode?.end === 'number') {
        const line = locStart.line
        const column = locStart.column + 1
        const loc = `${line}:${column}`

        const explicitBlock = readStaticJsxAttr(n, 'data-ak-block')
        const explicitId = readStaticJsxAttr(n, 'id')
        const blockId = explicitBlock ?? explicitId
        if (explicitBlock) {
          blocks.push({ blockId: explicitBlock, loc, line, column, sourceAttr: 'data-ak-block' })
        } else if (explicitId) {
          blocks.push({ blockId: explicitId, loc, line, column, sourceAttr: 'id' })
        }

        if (isIntrinsicTag(tagName)) {
          locations.push({
            tagName,
            loc,
            line,
            column,
            dynamic: nextDynamic,
            ...(blockId ? { blockId } : {}),
          })

          if (!hasJsxAttr(n, 'data-ak-loc')) {
            const dynamicAttr =
              nextDynamic && !hasJsxAttr(n, 'data-ak-dynamic') ? ' data-ak-dynamic="true"' : ''
            insertions.push({
              offset: nameNode.end,
              text: ` data-ak-loc="${loc}"${dynamicAttr}`,
            })
          }
        }
      }
    }

    for (const [key, value] of Object.entries(n)) {
      if (
        key === 'loc' ||
        key === 'start' ||
        key === 'end' ||
        key === 'tokens' ||
        key === 'comments'
      ) {
        continue
      }
      if (value && typeof value === 'object') {
        walk(value, nextDynamic)
      }
    }
  }

  walk(ast, false)

  return {
    code: applyInsertions(source, insertions),
    locations,
    blocks,
  }
}
