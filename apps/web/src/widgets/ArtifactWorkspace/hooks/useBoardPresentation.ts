import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasDocument } from '@/entities/artifact'

interface Target {
  pageId: string
  boardId: string
}

function lookupBoard(document: CanvasDocument, target: Target | null) {
  return target
    ? document.pages
        .find((page) => page.id === target.pageId)
        ?.boards.find((board) => board.id === target.boardId)
    : undefined
}

/** 试玩可以叠在聚焦之上；两者都不更改总览的选板、页面或相机。 */
export function useBoardPresentation(
  document: CanvasDocument,
  visible: boolean,
  focusOverviewBoard: (boardId: string) => void,
) {
  const [focus, setFocus] = useState<Target | null>(null)
  const [play, setPlay] = useState<Target | null>(null)
  const focusTrigger = useRef<HTMLButtonElement | null>(null)
  const playTrigger = useRef<HTMLButtonElement | null>(null)
  const focused = lookupBoard(document, focus)
  const playing = lookupBoard(document, play)

  useLayoutEffect(() => {
    if (!visible || playing) return
    const fallback = focused ? null : focusTrigger.current
    const target = playTrigger.current?.isConnected ? playTrigger.current : fallback
    playTrigger.current = null
    if (!focused) focusTrigger.current = null
    if (target?.isConnected) target.focus({ preventScroll: true })
  }, [focused, playing, visible])
  useEffect(() => {
    if (focus && !focused) setFocus(null)
    if (play && !playing) setPlay(null)
  }, [focus, focused, play, playing])

  return {
    focus,
    play,
    focused,
    playing,
    openFocus(target: Target, trigger: HTMLButtonElement | null) {
      focusTrigger.current = trigger
      setFocus(target)
    },
    openPlay(target: Target, trigger: HTMLButtonElement) {
      playTrigger.current = trigger
      setPlay(target)
    },
    closeFocus() {
      if (!focusTrigger.current?.isConnected && focused) focusOverviewBoard(focused.id)
      setFocus(null)
    },
    closePlay() {
      setPlay(null)
    },
    dismiss() {
      focusTrigger.current = null
      playTrigger.current = null
      setFocus(null)
      setPlay(null)
    },
    navigate(rawTarget: string) {
      setPlay((current) => {
        if (!current || current !== play) return current
        const activePage = document.pages.find((page) => page.id === current.pageId)
        const visited = new Set<string>()
        const match = (page: CanvasDocument['pages'][number]) => {
          for (const board of page.boards) {
            if (visited.has(board.id)) continue
            visited.add(board.id)
            if (board.id !== rawTarget && board.legacyBlockId !== rawTarget) continue
            if (
              document.flows.some(({ from, to }) => from === current.boardId && to === board.id)
            ) {
              return { pageId: page.id, boardId: board.id }
            }
          }
          return undefined
        }
        const local = activePage && match(activePage)
        if (local) return local
        for (const page of document.pages) {
          if (page === activePage) continue
          const destination = match(page)
          if (destination) return destination
        }
        return current
      })
    },
  }
}
