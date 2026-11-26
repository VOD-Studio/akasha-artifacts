import { parseDesignSystem } from '@akasha/kit'
import type { ArtifactRepository } from '../../domain/ports.js'
import type { NamedSystemPin, NamedSystemRepository } from '../../domain/team-systems.js'

/** 名单绑定固定版本、来源项目和生命周期；目录读取不会授予项目或原始文件权限。 */
export class SystemCatalog {
  constructor(
    readonly members: NamedSystemRepository,
    private readonly artifacts: ArtifactRepository,
  ) {}

  async pin(projectId: string, id: string, version: number): Promise<NamedSystemPin | undefined> {
    const artifact = await this.artifacts.findByPublicId(id)
    if (artifact?.projectId !== projectId || artifact.type !== 'design-system') return
    const generation = await this.artifacts.lifecycle.activeShareGeneration(id)
    if (generation !== undefined) return { projectId, id, version, generation }
  }

  async fixed(pin: NamedSystemPin) {
    const fixed = await this.artifacts.getVersion(pin.id, pin.version)
    if (!fixed) return
    const current = await this.pin(pin.projectId, pin.id, pin.version)
    if (current?.generation !== pin.generation) return
    const parsed = parseDesignSystem(fixed.source)
    if (parsed.ok) return { title: fixed.title, snapshot: parsed.data }
  }

  async list(project: string, userId: string) {
    const [owned, named] = await Promise.all([
      this.artifacts.listByProject(project),
      this.members.listNamed(userId),
    ])
    const pins = new Map(named.map((pin) => [`${pin.id}/${pin.version}`, pin]))
    for (const artifact of owned) {
      if (artifact.type !== 'design-system') continue
      const pin = await this.pin(project, artifact.publicId, artifact.headVersion)
      if (pin) pins.set(`${pin.id}/${pin.version}`, pin)
    }
    const items = []
    for (const pin of pins.values()) {
      const fixed = await this.fixed(pin)
      if (!fixed) continue
      const { components, guidance } = fixed.snapshot.draft
      items.push({
        id: pin.id,
        version: pin.version,
        title: fixed.title,
        components: components.map(({ path, exportName }) => ({ path, exportName })),
        guidance,
      })
    }
    return { items }
  }
}
