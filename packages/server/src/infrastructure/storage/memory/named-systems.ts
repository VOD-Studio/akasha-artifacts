import type { ArtifactRepository } from '../../../domain/ports.js'
import type { NamedSystemPin, NamedSystemRepository } from '../../../domain/team-systems.js'

const pinKey = ({ projectId, id, version, generation }: NamedSystemPin) =>
  JSON.stringify([projectId, id, version, generation])

/** 名单归内存容器独占；新名单完整构造后才替换，修改参数或返回值不会改变权限。 */
export function createMemoryNamedSystemRepository(
  artifacts: ArtifactRepository,
): NamedSystemRepository {
  const grants = new Map<string, { pin: NamedSystemPin; members: Map<string, string> }>()
  return {
    async listNamed(userId) {
      const pins: NamedSystemPin[] = []
      for (const { pin, members } of grants.values()) {
        if (!members.has(userId)) continue
        const artifact = await artifacts.findByPublicId(pin.id)
        if (artifact?.projectId !== pin.projectId) continue
        if ((await artifacts.lifecycle.activeShareGeneration(pin.id)) === pin.generation) {
          pins.push({ ...pin })
        }
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
  }
}
