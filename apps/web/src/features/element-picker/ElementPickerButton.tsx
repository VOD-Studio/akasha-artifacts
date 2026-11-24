import { Button } from '@akasha/ui/button'
import { Crosshair } from 'lucide-react'
import { useEffect } from 'react'
import { useSelectionStore } from '../../entities/selection/store'

export function ElementPickerButton({ onStart }: { onStart?: () => void } = {}) {
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
      variant={pickerActive ? 'secondary' : 'ghost'}
      size="sm"
      leftIcon={<Crosshair size={13} />}
      aria-pressed={pickerActive}
      onClick={() => {
        if (!pickerActive) onStart?.()
        togglePicker()
      }}
    >
      {pickerActive ? '取消指认（Esc）' : '指认元素'}
    </Button>
  )
}
