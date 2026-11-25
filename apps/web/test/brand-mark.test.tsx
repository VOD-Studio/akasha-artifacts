// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OpeningArtifact } from '../src/routes/ArtifactRouteStatus'
import { AkashaMark } from '../src/shared/brand'

afterEach(() => {
  cleanup()
})

describe('AkashaMark 品牌徽标与加载动效', () => {
  it('默认渲染静态装饰徽标，不挂载幽灵骨架层', () => {
    const { container } = render(<AkashaMark size={20} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('data-loading')).toBe('false')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('role')).toBeNull()
    expect(svg?.getAttribute('width')).toBe('20')
    expect(svg?.querySelector('.akasha-mark-ghost')).toBeNull()
  })

  it('开启 loading 时挂起三段动效状态与骨架层，提供 label 时暴露为图形', () => {
    render(<AkashaMark size={32} loading label="正在加载 Akasha" />)
    const svg = screen.getByRole('img', { name: '正在加载 Akasha' })
    expect(svg.getAttribute('data-loading')).toBe('true')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
    expect(svg.querySelector('.akasha-mark-ghost')).not.toBeNull()
  })

  it('OpeningArtifact 在等待状态展示动态品牌徽标', () => {
    const { container } = render(<OpeningArtifact />)
    expect(screen.getByRole('status').textContent).toContain('正在打开…')
    const svg = container.querySelector('svg.akasha-mark')
    expect(svg?.getAttribute('data-loading')).toBe('true')
  })
})
