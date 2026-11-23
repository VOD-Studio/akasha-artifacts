import { parse } from '@babel/parser'
import { print, types } from 'recast'
import type { LiteralTarget, SourcePatch } from './edit.js'

interface Node {
  type: string
  start: number
  end: number
  loc?: { start: { line: number; column: number } }
  name?: string | Node
  attributes?: Node[]
  openingElement?: Node
  closingElement?: Node | null
  children?: Node[]
  value?: Node | string | number | boolean | null
  expression?: Node
  body?: Node | Node[]
  argument?: Node
  declaration?: Node
  init?: Node
  id?: Node
  key?: Node
  computed?: boolean
  static?: boolean
}

const EMPTY = 'JSXEmptyExpression'
const b = types.builders
const printOptions = { quote: 'double' } as const

function stringNode(node: Node | string | number | boolean | null | undefined): Node | undefined {
  if (!node || typeof node !== 'object') return undefined
  const literal = node.type === 'JSXExpressionContainer' ? node.expression : node
  return literal?.type === 'StringLiteral' ? literal : undefined
}

function jsxTextValue(value: string): string {
  // React 移除 JSX 跨行缩进，但保留单行两侧的字面量空格。
  const lines = value.split(/\r\n|\r|\n/)
  const lastNonEmptyLine = lines.findLastIndex((line) => /[^ \t]/.test(line))
  let result = ''
  for (const [index, line] of lines.entries()) {
    let text = line.replace(/\t/g, ' ')
    if (index > 0) text = text.replace(/^ +/, '')
    if (index < lines.length - 1) text = text.replace(/ +$/, '')
    if (text) result += text + (index < lastNonEmptyLine ? ' ' : '')
  }
  return result
}

function textEditor(source: string, node: Node): LiteralTarget['text'] {
  if (!node.closingElement || !node.openingElement) return null
  const start = node.openingElement.end
  const end = node.closingElement.start
  const children = node.children ?? []
  const child = children[0]
  if (!child) {
    return { value: '', patch: (value) => ({ start, end, replacement: jsxTextMarkup(value) }) }
  }
  if (children.length !== 1) return null
  if (child.type === 'JSXText' && typeof child.value === 'string') {
    const raw = source.slice(start, end)
    const prefix = /^\s*\n[ \t]*/.exec(raw)?.[0] ?? ''
    const suffix = prefix.length < raw.length ? (/\r?\n[ \t]*$/.exec(raw)?.[0] ?? '') : ''
    return {
      value: jsxTextValue(child.value),
      patch: (value) => ({ start, end, replacement: `${prefix}${jsxTextMarkup(value)}${suffix}` }),
    }
  }
  const literal = stringNode(child)
  if (literal && typeof literal.value === 'string') {
    return {
      value: literal.value,
      patch: (value) => ({
        start: literal.start,
        end: literal.end,
        replacement: print(b.stringLiteral(value), {
          quote: source.charAt(literal.start) === "'" ? 'single' : 'double',
        }).code,
      }),
    }
  }
  return null
}

function jsxTextMarkup(value: string): string {
  if (/[<>&{}\r\n\t]|^\s|\s$/.test(value)) {
    return print(b.jsxExpressionContainer(b.stringLiteral(value)), printOptions).code
  }
  return print(b.jsxText(value)).code
}

function attributeEditor(source: string, opening: Node, attrs: Map<string, Node>) {
  return (name: string, value: string | null): SourcePatch | null => {
    const attr = attrs.get(name)
    if (attr && value === null) {
      let start = attr.start
      while (start > opening.start && /[ \t]/.test(source.charAt(start - 1))) start--
      return { start, end: attr.end, replacement: '' }
    }
    if (value === null) return null
    const literal = stringNode(attr?.value)
    if (literal && attr?.value !== literal) {
      const quote = source.charAt(literal.start) === "'" ? 'single' : 'double'
      return {
        start: literal.start,
        end: literal.end,
        replacement: print(b.stringLiteral(value), { quote }).code,
      }
    }
    const quote = literal && source.charAt(literal.start) === "'" ? "'" : '"'
    const escaped = value.replace(/[&<>"'\t\r\n]/g, (char) =>
      char !== quote && (char === '"' || char === "'") ? char : `&#${char.charCodeAt(0)};`,
    )
    const replacement = `${quote}${escaped}${quote}`
    if (literal) return { start: literal.start, end: literal.end, replacement }
    if (attr?.value && typeof attr.value === 'object') {
      return { start: attr.value.start, end: attr.value.end, replacement }
    }
    if (attr) return { start: attr.end, end: attr.end, replacement: `=${replacement}` }
    const tag = opening.name as Node
    return { start: tag.end, end: tag.end, replacement: ` ${name}=${replacement}` }
  }
}

function intrinsicName(element: Node): string | undefined {
  const name = element.openingElement?.name
  if (
    name &&
    typeof name !== 'string' &&
    name.type === 'JSXIdentifier' &&
    typeof name.name === 'string' &&
    /^[a-z]/.test(name.name)
  ) {
    return name.name
  }
  return undefined
}

function literalAttributes(opening: Node): Map<string, Node> | null {
  const result = new Map<string, Node>()
  for (const attr of opening.attributes ?? []) {
    const name = attr.name
    if (
      attr.type !== 'JSXAttribute' ||
      !name ||
      typeof name === 'string' ||
      typeof name.name !== 'string'
    )
      return null
    if (
      ['data-ak-loc', 'data-ak-dynamic', 'dangerouslySetInnerHTML'].includes(name.name) ||
      result.has(name.name)
    )
      return null
    if (attr.value && !stringNode(attr.value)) {
      const expr = typeof attr.value === 'object' ? attr.value.expression : undefined
      if (
        name.name === 'className' ||
        !expr ||
        !['BooleanLiteral', 'NumericLiteral', 'NullLiteral'].includes(expr.type)
      )
        return null
    }
    result.set(name.name, attr)
  }
  return result
}

function directComponentReturn(path: readonly Node[], child: Node): boolean {
  let current = child
  let index = path.length - 1
  let parent = path[index]
  while (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
    if (
      !parent.children?.includes(current) ||
      (parent.type === 'JSXElement' && !intrinsicName(parent))
    )
      return false
    current = parent
    parent = path[--index]
  }
  if (parent?.type === 'ReturnStatement' && parent.argument === current) {
    const block = path[--index]
    parent = path[--index]
    if (block?.type !== 'BlockStatement' || parent?.body !== block) return false
  } else if (parent?.type !== 'ArrowFunctionExpression' || parent.body !== current) {
    return false
  }
  if (parent?.type === 'ClassMethod') {
    if (
      parent.computed ||
      parent.static ||
      parent.key?.name !== 'render' ||
      path[--index]?.type !== 'ClassBody'
    )
      return false
    parent = path[--index]
    if (parent?.type !== 'ClassDeclaration' && parent?.type !== 'ClassExpression') return false
  } else if (
    !parent ||
    !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(parent.type)
  ) {
    return false
  }
  let name = parent.id?.name
  let declaration = path[--index]
  if (declaration?.type === 'ExportDefaultDeclaration') return declaration.declaration === parent
  if (declaration?.type === 'VariableDeclarator' && declaration.init === parent) {
    name = declaration.id?.name
    declaration = path[--index]
    if (declaration?.type !== 'VariableDeclaration') return false
    declaration = path[--index]
  }
  if (declaration?.type === 'ExportNamedDeclaration') declaration = path[--index]
  // 只允许导出为默认渲染入口的组件，避免把循环中复用的顶层辅助渲染函数视为静态。
  return (
    typeof name === 'string' &&
    declaration?.type === 'Program' &&
    Array.isArray(declaration.body) &&
    declaration.body.some(
      (stmt) =>
        stmt.type === 'ExportDefaultDeclaration' &&
        stmt.declaration?.type === 'Identifier' &&
        stmt.declaration.name === name,
    )
  )
}

/**
 * 收集 TSX 源码里可直改的静态节点，以 `loc` 为键。
 *
 * @remarks 只收集默认导出组件直接返回的 JSX 中的原生元素；循环或表达式生成的节点不算。
 */
export function collectJsxTargets(source: string): Map<string, LiteralTarget> {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  }) as unknown as Node
  const targets = new Map<string, LiteralTarget>()
  const path: Node[] = []
  const byNode = new Map<Node, LiteralTarget>()
  const subtreeStatic = new Map<Node, boolean>()

  function isStaticChild(child: Node): boolean {
    return (
      child.type === 'JSXText' ||
      child.expression?.type === EMPTY ||
      Boolean(stringNode(child)) ||
      subtreeStatic.get(child) === true
    )
  }

  function walk(node: Node): void {
    path.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'tokens' || key.endsWith('Comments')) continue
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child)
        }
      } else if (value && typeof value.type === 'string') {
        walk(value)
      }
    }
    path.pop()
    if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return
    const children = node.children ?? []
    const tagName = intrinsicName(node)
    const opening = node.openingElement
    const attrs = opening && literalAttributes(opening)
    const isStatic =
      (node.type === 'JSXFragment' || Boolean(tagName && attrs)) && children.every(isStaticChild)
    subtreeStatic.set(node, isStatic)
    const start = opening?.loc?.start
    if (!isStatic || !tagName || !opening || !attrs || !start || !directComponentReturn(path, node))
      return
    const loc = `${start.line}:${start.column + 1}`
    const parent = path.at(-1)
    const classAttr = stringNode(attrs.get('className')?.value)
    const target: LiteralTarget = {
      loc,
      tagName,
      start: node.start,
      end: node.end,
      text: textEditor(source, node),
      className: typeof classAttr?.value === 'string' ? classAttr.value : '',
      attribute: attributeEditor(source, opening, attrs),
      removal: parent?.children?.includes(node) ? '' : 'null',
    }
    // 夹有文字、Fragment 或动态渲染项时，DOM 顺序不能映射成直接兄弟索引。
    if (
      children.every(
        (child) =>
          byNode.has(child) ||
          child.expression?.type === EMPTY ||
          (child.type === 'JSXText' && typeof child.value === 'string' && !child.value.trim()),
      )
    ) {
      target.children = []
      for (const child of children) {
        const entry = byNode.get(child)
        if (entry) {
          entry.parentLoc = loc
          target.children.push(entry)
        }
      }
    }
    byNode.set(node, target)
    targets.set(loc, target)
  }

  walk(ast)
  return targets
}
