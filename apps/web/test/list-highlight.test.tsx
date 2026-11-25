// @vitest-environment jsdom
import { ListHighlight, ListHighlightItem } from '@akasha/ui/list-highlight'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

function createRect(top: number, height = 32): DOMRect {
  return {
    x: 4,
    y: top,
    top,
    left: 4,
    right: 184,
    bottom: top + height,
    width: 180,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function flushAnimationFrames(count: number) {
  for (let i = 0; i < count; i += 1) {
    vi.advanceTimersToNextFrame()
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ListHighlight focus mode', () => {
  it('跨分隔线移动时保留高亮起点并平滑滑动，停在禁用项或移出面板时收起', () => {
    vi.useFakeTimers()
    render(
      <ListHighlight mode="focus">
        <div role="menu" tabIndex={-1} data-testid="menu">
          <ListHighlightItem>
            <div role="menuitem" tabIndex={-1}>
              复制链接
            </div>
          </ListHighlightItem>
          <hr data-testid="sep" />
          <ListHighlightItem>
            <div role="menuitem" tabIndex={-1}>
              查看源码
            </div>
          </ListHighlightItem>
          <ListHighlightItem>
            <div role="menuitem" tabIndex={-1} aria-disabled="true" data-disabled="">
              已禁用
            </div>
          </ListHighlightItem>
        </div>
      </ListHighlight>,
    )

    const menu = screen.getByTestId('menu')
    const first = screen.getByRole('menuitem', { name: '复制链接' })
    const second = screen.getByRole('menuitem', { name: '查看源码' })
    const disabled = screen.getByRole('menuitem', { name: '已禁用' })
    const separator = screen.getByTestId('sep')

    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(createRect(0, 140))
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(createRect(4, 32))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(createRect(49, 32))
    vi.spyOn(disabled, 'getBoundingClientRect').mockReturnValue(createRect(82, 32))
    const setAttrSpy = vi.spyOn(menu, 'setAttribute')

    // 首次出现：短暂置 jump 落位后立即恢复过渡，避免首帧飞入或首次切换硬跳
    fireEvent.pointerOver(first, { pointerType: 'mouse' })
    fireEvent.focusIn(first)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')
    expect(menu.getAttribute('data-list-highlight-jump')).toBeNull()
    expect(setAttrSpy).toHaveBeenCalledWith('data-list-highlight-jump', 'true')
    expect(menu.style.getPropertyValue('--v-list-hl-y')).toBe('4px')

    setAttrSpy.mockClear()

    // 经过分隔线，Radix 把焦点交还菜单容器：多帧后仍保留高亮起点
    fireEvent.pointerMove(separator, { pointerType: 'mouse' })
    fireEvent.focusOut(first, { relatedTarget: menu })
    fireEvent.focusIn(menu)
    flushAnimationFrames(5)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')
    expect(menu.style.getPropertyValue('--v-list-hl-y')).toBe('4px')

    // 进入分隔线后的第二项：不再置 jump，平滑滑动到 49px
    fireEvent.pointerMove(second, { pointerType: 'mouse' })
    fireEvent.focusIn(second)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')
    expect(setAttrSpy).not.toHaveBeenCalledWith('data-list-highlight-jump', 'true')
    expect(menu.style.getPropertyValue('--v-list-hl-y')).toBe('49px')

    // 指针停在禁用项时立即收起高亮
    fireEvent.pointerMove(disabled, { pointerType: 'mouse' })
    fireEvent.focusOut(second, { relatedTarget: menu })
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('false')

    // 回到正常项后移出菜单容器时立即收起高亮
    fireEvent.pointerMove(second, { pointerType: 'mouse' })
    fireEvent.focusIn(second)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')
    fireEvent.focusOut(second, { relatedTarget: menu })
    fireEvent.pointerLeave(menu, { pointerType: 'mouse' })
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('false')
  })

  it('无分隔线的相邻项经过间隙时不触发硬跳', () => {
    vi.useFakeTimers()
    render(
      <ListHighlight mode="focus">
        <div role="menu" tabIndex={-1} data-testid="menu">
          <div data-testid="group">
            <ListHighlightItem>
              <div role="menuitemradio" aria-checked="false" tabIndex={-1}>
                全部项目
              </div>
            </ListHighlightItem>
            <ListHighlightItem>
              <div role="menuitemradio" aria-checked="true" tabIndex={-1}>
                akasha-artifacts
              </div>
            </ListHighlightItem>
          </div>
        </div>
      </ListHighlight>,
    )

    const menu = screen.getByTestId('menu')
    const group = screen.getByTestId('group')
    const allItem = screen.getByRole('menuitemradio', { name: '全部项目' })
    const projectItem = screen.getByRole('menuitemradio', { name: 'akasha-artifacts' })

    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(createRect(0, 76))
    vi.spyOn(allItem, 'getBoundingClientRect').mockReturnValue(createRect(4, 32))
    vi.spyOn(projectItem, 'getBoundingClientRect').mockReturnValue(createRect(37, 32))
    const setAttrSpy = vi.spyOn(menu, 'setAttribute')

    fireEvent.pointerEnter(menu, { pointerType: 'mouse' })
    fireEvent.pointerMove(projectItem, { pointerType: 'mouse' })
    fireEvent.focusIn(projectItem)
    expect(menu.style.getPropertyValue('--v-list-hl-y')).toBe('37px')
    setAttrSpy.mockClear()

    // 经过 group 间隙，Radix 把焦点交还 menu，多帧后进入上一项
    fireEvent.focusOut(projectItem, { relatedTarget: menu })
    fireEvent.focusIn(menu)
    fireEvent.pointerMove(group, { pointerType: 'mouse' })
    flushAnimationFrames(3)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')

    fireEvent.pointerMove(allItem, { pointerType: 'mouse' })
    fireEvent.focusIn(allItem)
    expect(menu.getAttribute('data-list-highlight-visible')).toBe('true')
    expect(setAttrSpy).not.toHaveBeenCalledWith('data-list-highlight-jump', 'true')
    expect(menu.style.getPropertyValue('--v-list-hl-y')).toBe('4px')
  })
})
