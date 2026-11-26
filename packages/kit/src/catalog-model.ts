type ModelResult = { source: string; corrected: boolean } | { reason: 'instance' | 'reference' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key))
}

function validProps(expected: unknown, candidate: unknown) {
  if (!record(expected) || !record(candidate) || !sameKeys(expected, candidate)) return false
  return Object.entries(candidate).every(([key, value]) => {
    if (typeof value !== typeof expected[key]) return false
    return (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 8192)
    )
  })
}

// JSON.parse 只保留重复键的最后一个值。校验完全部形状后，额外的对象键必然来自重复。
function propertyCount(json: string) {
  let count = 0
  let quoted = false
  for (let i = 0; i < json.length; i++) {
    const char = json[i]
    if (quoted && char === '\\') i++
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ':') count++
  }
  return count
}

const guidance = {
  color: true,
  fontFamily: true,
  instructions: true,
  spacing: true,
  css: true,
  guidelines: true,
}

/** 仅接收单行 JSON 数据；重复键、陌生字段和错位实例都不能静默覆盖业务数据。 */
export function reconcileCatalogModel(expected: string, candidate: string): ModelResult {
  try {
    const model: unknown = JSON.parse(expected)
    const edited: unknown = JSON.parse(candidate)
    if (!record(model) || !record(edited) || !sameKeys(model, edited)) return { reason: 'instance' }
    const components = model.components
    const instances = edited.components
    if (
      !Array.isArray(components) ||
      !Array.isArray(instances) ||
      components.length !== instances.length
    )
      return { reason: 'instance' }
    for (const [i, component] of components.entries()) {
      const instance: unknown = instances[i]
      if (
        !record(component) ||
        !record(instance) ||
        !sameKeys(component, instance) ||
        component.path !== instance.path ||
        component.exportName !== instance.exportName ||
        !validProps(component.props, instance.props)
      )
        return { reason: 'instance' }
      component.props = instance.props
    }
    let corrected = false
    for (const [key, value] of Object.entries(model)) {
      if (key === 'components') continue
      const actual = edited[key]
      if (JSON.stringify(actual) === JSON.stringify(value)) continue
      if (key === 'origin' || key === 'sourceVersion') return { reason: 'reference' }
      if (!Object.hasOwn(guidance, key) || typeof actual !== typeof value)
        return { reason: 'instance' }
      if (
        Array.isArray(value) &&
        (!Array.isArray(actual) ||
          actual.length !== value.length ||
          !actual.every((item) => typeof item === 'string'))
      )
        return { reason: 'instance' }
      corrected = true
    }
    if (propertyCount(candidate) !== propertyCount(expected)) return { reason: 'instance' }
    return { source: JSON.stringify(model), corrected }
  } catch {
    return { reason: 'instance' }
  }
}
