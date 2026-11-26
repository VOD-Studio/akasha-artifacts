import { parseDesignSystem } from '@akasha/kit'
import type { CatalogSystem, SystemPublicationAction } from '@akasha/protocol'
import { DomainError, NotFoundError } from '../../domain/errors.js'
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

  async changePublication(
    project: string,
    userId: string,
    id: string,
    version: number,
    action: SystemPublicationAction,
  ) {
    const own = await this.pin(project, id, version)
    const named = own ? [] : await this.members.listNamed(userId)
    const granted = own ?? named.find((pin) => pin.id === id && pin.version === version)
    const pin =
      granted ??
      (await this.members.listPublications()).find(
        (item) => item.id === id && item.version === version && !item.withdrawn,
      )
    if (!pin || !(await this.fixed(pin))) throw new NotFoundError('找不到可用的固定版本')
    if (!(await this.members.setPublication(pin, action)))
      throw new DomainError('RESOURCE_CONFLICT', '团队发布状态已变化，请刷新目录后重试')
  }

  async list(project: string, userId: string) {
    const [owned, named, published] = await Promise.all([
      this.artifacts.listByProject(project),
      this.members.listNamed(userId),
      this.members.listPublications(),
    ])
    const pins = new Map(named.map((pin) => [`${pin.id}/${pin.version}`, pin]))
    for (const artifact of owned) {
      if (artifact.type !== 'design-system') continue
      const pin = await this.pin(project, artifact.publicId, artifact.headVersion)
      if (pin) pins.set(`${pin.id}/${pin.version}`, pin)
    }
    const releases = new Map(published.map((pin) => [`${pin.id}/${pin.version}`, pin]))
    for (const [key, release] of releases) {
      if (release.withdrawn) pins.delete(key)
      else pins.set(key, release)
    }
    const items: CatalogSystem[] = []
    for (const pin of pins.values()) {
      const fixed = await this.fixed(pin)
      if (!fixed) continue
      const { components, guidance } = fixed.snapshot.draft
      const release = releases.get(`${pin.id}/${pin.version}`)
      items.push({
        id: pin.id,
        version: pin.version,
        title: fixed.title,
        components: components.map(({ path, exportName }) => ({ path, exportName })),
        guidance,
        publication: release ? 'team' : 'private',
        isDefault: release?.isDefault ?? false,
      })
    }
    return { items }
  }
}
