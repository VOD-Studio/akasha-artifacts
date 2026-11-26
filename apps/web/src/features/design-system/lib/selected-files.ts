import type { DesignSystemDraft } from '@akasha/protocol'
import { getMessages } from '@/shared/i18n'
import { readContent } from '@/shared/lib/selected-file'
import { messages } from '../messages'

type SourceFile = DesignSystemDraft['files'][number]
export interface FileChoice {
  file: File
  path: string
  kind: SourceFile['kind']
}

export const accepts =
  '.tsx,.jsx,.ts,.js,.json,.css,.woff,.woff2,.ttf,.otf,.svg,.png,.jpg,.jpeg,.webp,.md,.txt,.fig'

/** 目录选择阶段只列名称，不读内容；相对路径从所选目录的根开始。 */
export function fileChoices(files: FileList): FileChoice[] {
  const choices: FileChoice[] = []
  const paths = new Set<string>()
  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath?.split('/').slice(1).join('/') || file.name
    if (path.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) continue
    let kind: SourceFile['kind']
    if (/\.(jsx?|tsx?|css|json)$/i.test(path)) kind = 'source'
    else if (/\.(woff2?|[ot]tf)$/i.test(path)) kind = 'font'
    else if (/\.(svg|png|jpe?g|webp)$/i.test(path)) kind = 'logo'
    else if (/\.fig$/i.test(path)) kind = 'figma'
    else if (/\.(md|txt)$/i.test(path)) kind = 'guidelines'
    else continue
    if (paths.has(path)) throw new Error(getMessages(messages).t('文件名重复'))
    paths.add(path)
    choices.push({ path, file, kind })
  }
  return choices
}

/** 用户授权某一批文件后才读取；整批成功才交给草稿，不写磁盘或连接远端。 */
export async function readChosenFiles(choices: FileChoice[]): Promise<SourceFile[]> {
  const { t } = getMessages(messages)
  const max = 2 * 1024 * 1024
  const files: SourceFile[] = []
  let total = 0
  if (choices.length > 128) throw new Error(t('文件超出导入限制。'))
  for (const { file, path, kind } of choices) {
    const binary = kind !== 'source' && kind !== 'guidelines'
    if (binary ? 4 * Math.ceil(file.size / 3) > max : file.size > max * 3 + 3) {
      throw new Error(t('文件超出导入限制。'))
    }
    const content = await readContent(file, binary)
    total += content.length
    if (content.length > max || total > max * 3) throw new Error(t('文件超出导入限制。'))
    files.push({ path, kind, content })
  }
  return files
}

/** 参考仅保存为来源记录，不代表已获准读取 Figma 文档。 */
export function figmaReference(value: string): SourceFile | undefined {
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      !/^(?:www\.)?figma\.com$/i.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return
    const key = url.pathname.match(/^\/(?:design|file|proto|board|slides)\/([\w-]+)(?:\/|$)/)?.[1]
    if (!key) return
    const node = url.searchParams.get('node-id')
    const suffix = node && /^[\d:-]+$/.test(node) ? `-${node.replaceAll(':', '-')}` : ''
    return { path: `references/${key}${suffix}.url`, kind: 'figma', content: url.href }
  } catch {
    return undefined
  }
}
