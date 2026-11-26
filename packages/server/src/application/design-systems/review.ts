import { createHash } from 'node:crypto'
import { extname } from 'node:path/posix'
import { designSystemPreviewSource } from '@akasha/kit'
import type {
  DesignSystemDraft,
  DesignSystemPreviewInput,
  DesignSystemSnapshot,
} from '@akasha/protocol'
import { DomainError } from '../../domain/errors.js'
import { bundleSelectedComponents } from './bundle.js'

function isFigmaReference(url: string) {
  try {
    const link = new URL(url)
    return (
      link.protocol === 'https:' &&
      ['figma.com', 'www.figma.com'].includes(link.hostname) &&
      !link.username &&
      !link.password &&
      !link.port &&
      /^\/(design|file|proto|board|slides)\/.+/.test(link.pathname)
    )
  } catch {
    return false
  }
}

function hasSvgRoot(bytes: Buffer): boolean {
  let source = bytes.toString('utf8').trimStart()
  if (source.startsWith('<?xml')) {
    const end = source.indexOf('?>')
    if (end < 0) return false
    source = source.slice(end + 2).trimStart()
  }
  while (source.startsWith('<!--')) {
    const end = source.indexOf('-->', 4)
    if (end < 0) return false
    source = source.slice(end + 3).trimStart()
  }
  return /^<svg[\s>]/i.test(source)
}

function validateFile(file: DesignSystemDraft['files'][number]) {
  const ext = extname(file.path).toLowerCase()
  if (file.kind === 'guidelines') return
  if (file.kind === 'source') {
    if (!/^\.(?:[jt]sx?|json|css)$/.test(ext))
      throw new DomainError('BAD_REQUEST', `不支持的源码格式：${file.path}`)
    return
  }
  if (file.kind === 'figma' && isFigmaReference(file.content)) return
  const bytes = Buffer.from(file.content, 'base64')
  if (!bytes.length || bytes.toString('base64') !== file.content)
    throw new DomainError('BAD_REQUEST', `无效的文件编码：${file.path}`)
  const start = bytes.toString('latin1', 0, 12)
  const starts = (match: string) => start.startsWith(match)
  if (
    file.kind === 'font' &&
    ((ext === '.woff' && starts('wOFF')) ||
      (ext === '.woff2' && starts('wOF2')) ||
      (ext === '.otf' && starts('OTTO')) ||
      (ext === '.ttf' && (starts('\x00\x01\x00\x00') || starts('true'))))
  )
    return
  if (
    file.kind === 'logo' &&
    ((ext === '.png' && starts('\x89PNG\r\n\x1a\n')) ||
      (/^\.jpe?g$/.test(ext) && starts('\xff\xd8\xff')) ||
      (ext === '.webp' && starts('RIFF') && start.endsWith('WEBP')) ||
      (ext === '.svg' && hasSvgRoot(bytes)))
  )
    return
  if (file.kind === 'figma' && ext === '.fig' && (starts('fig-kiwi') || starts('PK\x03\x04')))
    return
  throw new DomainError('BAD_REQUEST', `文件类型或内容不受支持：${file.path}`)
}

/** 摘要只描述来源，不因修改人工使用说明、预览参数或选择顺序而变。 */
function fingerprint(draft: DesignSystemDraft) {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(draft.origin))
  for (const item of draft.files.toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    hash.update(
      JSON.stringify([
        item.path,
        item.kind,
        createHash('sha256').update(item.content).digest('hex'),
      ]),
    )
  }
  return hash.digest('hex')
}

/** 不调用项目构建脚本、包管理器或远端来源。未授权时不启动静态编译器。 */
export async function previewDesignSystem({
  draft,
  buildApproved,
}: DesignSystemPreviewInput): Promise<Omit<DesignSystemSnapshot, 'draft'>> {
  if (draft.components.length && !buildApproved)
    throw new DomainError('FORBIDDEN', '尚未许可构建所选组件')
  for (const file of draft.files) validateFile(file)
  const modules = draft.components.length ? await bundleSelectedComponents(draft) : []
  const sourceVersion = fingerprint(draft)
  return { sourceVersion, ...designSystemPreviewSource(draft, sourceVersion, modules) }
}
