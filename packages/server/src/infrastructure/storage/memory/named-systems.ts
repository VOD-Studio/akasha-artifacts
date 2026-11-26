import type { ArtifactRepository } from '../../../domain/ports.js'
import type {
  NamedSystemPin,
  NamedSystemRepository,
  SystemPublication,
} from '../../../domain/team-systems.js'

const pinKey = ({ projectId, id, version, generation }: NamedSystemPin) =>
  JSON.stringify([projectId, id, version, generation])

/** 名单归内存容器独占；新名单完整构造后才替换，修改参数或返回值不会改变权限。 */
export function createMemoryNamedSystemRepository(
  artifacts: ArtifactRepository,
): NamedSystemRepository {
  const grants = new Map<string, { pin: NamedSystemPin; members: Map<string, string> }>()
  const publications = new Map<string, Omit<SystemPublication, 'isDefault'>>()
  const defaultOptOuts = new Set<string>()
  let defaultKey: string | undefined
  const isCurrent = async (pin: NamedSystemPin) => {
    const artifact = await artifacts.findByPublicId(pin.id)
    return (
      artifact?.projectId === pin.projectId &&
      artifact.type === 'design-system' &&
      (await artifacts.lifecycle.activeShareGeneration(pin.id)) === pin.generation
    )
  }
  return {
    async inheritDefault(userId) {
      return !defaultOptOuts.has(userId)
    },
    async setInheritDefault(userId, enabled) {
      if (enabled) defaultOptOuts.delete(userId)
      else defaultOptOuts.add(userId)
    },
    async listNamed(userId) {
      const pins: NamedSystemPin[] = []
      for (const { pin, members } of grants.values()) {
        if (members.has(userId) && (await isCurrent(pin))) pins.push({ ...pin })
      }
      return pins
    },
    async getMembers(pin) {
      return Array.from(grants.get(pinKey(pin))?.members ?? [], ([userId, login]) => ({
        userId,
        login,
      }))
    },
    async setMembers(pin, members) {
      const key = pinKey(pin)
      if (!members.length) {
        grants.delete(key)
        return
      }
      const next = new Map<string, string>()
      for (const { userId, login } of members) {
        if (next.has(userId)) throw new Error('固定版本名单中存在重复账号')
        next.set(userId, login)
      }
      grants.set(key, { pin: { ...pin }, members: next })
    },
    async listPublications() {
      const result: SystemPublication[] = []
      const selected = defaultKey
      for (const [key, publication] of [...publications]) {
        if (await isCurrent(publication))
          result.push({ ...publication, isDefault: selected === key })
      }
      return result
    },
    async publication(pin) {
      if (!(await isCurrent(pin))) return
      const key = pinKey(pin)
      const record = publications.get(key)
      return record && { ...record, isDefault: key === defaultKey }
    },
    async setPublication(pin, action) {
      if (!(await isCurrent(pin))) return false
      const key = pinKey(pin)
      if (action === 'publish') {
        if (!(await artifacts.getVersion(pin.id, pin.version))) return false
        publications.set(key, { ...pin, withdrawn: false })
        return true
      }
      const record = publications.get(key)
      if (!record || record.withdrawn) return false
      switch (action) {
        case 'default':
          defaultKey = key
          break
        case 'clear-default':
          if (key !== defaultKey) return false
          defaultKey = undefined
          break
        case 'withdraw':
          if (key === defaultKey) defaultKey = undefined
          publications.set(key, { ...record, withdrawn: true })
          break
      }
      return true
    },
  }
}
