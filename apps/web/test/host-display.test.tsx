// @vitest-environment jsdom
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HostDisplayItems } from '../src/widgets/TopBar/ui/HostDisplayItems'

afterEach(cleanup)

function renderMenu() {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>打开作品菜单</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>查看</DropdownMenuItem>
        <HostDisplayItems />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
  return () =>
    fireEvent.keyDown(screen.getByRole('button', { name: '打开作品菜单' }), { key: 'Enter' })
}

it('宿主拒绝全屏时不假装已进入，从系统退出时作品菜单同步恢复', async () => {
  const root = document.documentElement
  let active: Element | null = null
  const change = (next: Element | null) => {
    active = next
    document.dispatchEvent(new Event('fullscreenchange'))
  }
  const enter = vi
    .fn()
    .mockRejectedValueOnce(new Error('denied'))
    .mockImplementation(() => {
      change(root)
      return Promise.resolve()
    })
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
  Object.defineProperty(document, 'fullscreenElement', { get: () => active, configurable: true })
  Object.defineProperty(document, 'exitFullscreen', {
    value: async () => change(null),
    configurable: true,
  })
  Object.defineProperty(root, 'requestFullscreen', { value: enter, configurable: true })
  try {
    const open = renderMenu()
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: '全屏查看' }))
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: '全屏查看' }))
    open()
    await screen.findByRole('menuitem', { name: '退出全屏' })
    act(() => change(null))
    await screen.findByRole('menuitem', { name: '全屏查看' })
    expect(screen.queryByRole('menuitem', { name: '退出全屏' })).toBeNull()
  } finally {
    Reflect.deleteProperty(document, 'fullscreenEnabled')
    Reflect.deleteProperty(document, 'fullscreenElement')
    Reflect.deleteProperty(document, 'exitFullscreen')
    Reflect.deleteProperty(root, 'requestFullscreen')
  }
})
