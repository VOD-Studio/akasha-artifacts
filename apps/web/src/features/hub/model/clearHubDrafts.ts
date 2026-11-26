import { clearCanvasTextDrafts } from '@/entities/artifact'
import { clearAnnotationDrafts } from '@/entities/feedback'

/** 换号前清除本标签页里的作品文字和批注，不把私有草稿交给下一个身份。 */
export function clearHubDrafts(): void {
  clearCanvasTextDrafts()
  clearAnnotationDrafts()
}
