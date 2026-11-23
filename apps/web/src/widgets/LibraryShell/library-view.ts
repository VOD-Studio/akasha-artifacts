import type { ArtifactType } from '@akasha/protocol'
import { create } from 'zustand'

interface LibraryView {
  search: string
  type: ArtifactType | 'all'
  favoritesOnly: boolean
  order: 'recent' | 'title'
  layout: 'cards' | 'list'
  scrollTop: number
}

/** 库页离开后保留本标签的筛选与滚动位置，不持久化到账号或制品。 */
export const useLibraryView = create<LibraryView>(() => ({
  search: '',
  type: 'all',
  favoritesOnly: false,
  order: 'recent',
  layout: 'cards',
  scrollTop: 0,
}))
