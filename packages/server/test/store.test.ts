import { describe, expect, it } from 'vitest'
import { ArtifactStore } from '../src/index.js'

describe('ArtifactStore', () => {
  it('tracks versions and applies live in-place state patches', () => {
    const store = new ArtifactStore()

    const v1 = store.publish({
      id: 'pr-142-walkthrough',
      title: 'Auth Session Refactor Walkthrough',
      type: 'pr-walkthrough',
      content: '# PR #142',
    })

    expect(v1.version).toBe(1)
    expect(v1.visibility).toBe('private')

    const updated = store.pushState({
      id: 'pr-142-walkthrough',
      patch: { step: 2, status: 'verified' },
    })

    expect(updated.version).toBe(1)
    expect(updated.state).toEqual({ step: 2, status: 'verified' })

    const v2 = store.publish({
      id: 'pr-142-walkthrough',
      title: 'Auth Session Refactor Walkthrough (v2)',
      type: 'pr-walkthrough',
      content: '# PR #142 Updated',
      visibility: 'team',
    })

    expect(v2.version).toBe(2)
    expect(v2.visibility).toBe('team')
    expect(v2.state).toEqual({ step: 2, status: 'verified' })
    expect(store.getHistory('pr-142-walkthrough')).toHaveLength(2)
  })
})
