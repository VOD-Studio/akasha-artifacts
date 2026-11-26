import fs from 'node:fs/promises'
import path from 'node:path'
import { CodingSessionPublishSchema } from '@akasha/protocol'

/** 仅发送列出的项目文件，拒绝越出工作区的路径和符号链接，不扫描目录或读仓库凭据。 */
export async function readCodingPublication(
  workspace: string,
  flag: (key: string) => string | undefined,
  dependencies: string[],
) {
  const entry = flag('file')
  if (!entry) throw new Error('请用 --file 指定一个作品或组件文件')
  const exportName = flag('export')
  if (!exportName && (dependencies.length || flag('props')))
    throw new Error('组件依赖和 props 须与 --export 同用')
  const paths = [entry, ...dependencies]
  if (paths.length > 128) throw new Error('所选文件过多')
  const files = []
  let size = 0
  for (const name of paths) {
    if (
      path.isAbsolute(name) ||
      name.split(/[\\/]/).some((part) => !part || part.startsWith('.') || part === 'node_modules')
    )
      throw new Error('只接受工作区内的显式相对文件路径')
    const selected = path.resolve(workspace, name)
    const canonical = await fs.realpath(selected)
    if (selected !== canonical || !canonical.startsWith(workspace + path.sep))
      throw new Error('不能发布符号链接或工作区外文件')
    const stat = await fs.stat(canonical)
    size += stat.size
    if (!stat.isFile() || size > 8 * 1024 * 1024)
      throw new Error('请选择不超过 8 MiB 的普通工程文件')
    files.push({ path: name, content: await fs.readFile(canonical, 'utf8') })
  }
  return CodingSessionPublishSchema.parse(
    exportName
      ? { component: { path: entry, exportName, props: JSON.parse(flag('props') ?? '{}'), files } }
      : { source: files[0]?.content },
  )
}
