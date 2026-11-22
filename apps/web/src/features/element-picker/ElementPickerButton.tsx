import { Button } from '@akasha/ui/button'
import { Crosshair } from 'lucide-react'
import { useEffect } from 'react'
import { useSelectionStore } from '../../entities/selection/store'

// 顶栏指认元素切换按钮：开启后沙盒进入无 UI 命中探测，按 Esc 可随时退出。
export function ElementPickerButton() {
  const pickerActive = useSelectionStore((s) => s.pickerActive)
  const togglePicker = useSelectionStore((s) => s.togglePicker)
  const setPickerActive = useSelectionStore((s) => s.setPickerActive)

  useEffect(() => {
    if (!pickerActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPickerActive(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pickerActive, setPickerActive])

  return (
    <Button
      variant={pickerActive ? 'primary' : 'outline'}
      size="sm"
      leftIcon={<Crosshair size={13} />}
      aria-pressed={pickerActive}
      onClick={togglePicker}
    >
      {pickerActive ? '指认中 (Esc 退出)' : '指认元素'}
    </Button>
  )
}
