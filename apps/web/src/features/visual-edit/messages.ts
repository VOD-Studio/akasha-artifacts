import type { Messages } from '@/shared/i18n'

export const panelMessages = {
  没有编辑权限: [
    'Keine Berechtigung zum Bearbeiten',
    'ليس لديك إذن بالتعديل',
    'You do not have permission to edit',
  ],
  保存: ['Speichern', 'حفظ', 'Save'],
  文字: ['Text', 'النص', 'Text'],
  '这段文字不能直接编辑。可选择子元素或添加批注。': [
    'Dieser Text ist nicht direkt bearbeitbar. Wählen Sie ein Unterelement oder fügen Sie einen Kommentar hinzu.',
    'لا يمكن تعديل هذا النص مباشرة. اختر عنصرًا فرعيًا أو أضف تعليقًا.',
    'This text cannot be edited directly. Select a child element or add a comment.',
  ],
  'Tailwind 类名': ['Tailwind-Klassen', 'فئات Tailwind', 'Tailwind classes'],
  用空格分隔: ['Mit Leerzeichen trennen', 'افصل بمسافات', 'Separate with spaces'],
  元素顺序: ['Elementreihenfolge', 'ترتيب العناصر', 'Element order'],
  '拖动选中项，或使用上移、下移。': [
    'Auswahl ziehen oder nach oben bzw. unten verschieben.',
    'اسحب العنصر المحدد أو استخدم زري التحريك لأعلى ولأسفل.',
    'Drag the selected item or use Move up and Move down.',
  ],
  上移: ['Nach oben', 'تحريك لأعلى', 'Move up'],
  下移: ['Nach unten', 'تحريك لأسفل', 'Move down'],
  添加批注: ['Kommentar hinzufügen', 'إضافة تعليق', 'Add comment'],
  确认删除: ['Löschen bestätigen', 'تأكيد الحذف', 'Confirm deletion'],
  删除元素: ['Element löschen', 'حذف العنصر', 'Delete element'],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
  '元素及其内容将被删除。': [
    'Das Element und sein Inhalt werden gelöscht.',
    'سيُحذف العنصر ومحتواه.',
    'This element and its contents will be deleted.',
  ],
  '选择要编辑的元素。无法直接编辑时将打开批注。': [
    'Element zum Bearbeiten auswählen. Ist keine direkte Bearbeitung möglich, öffnen sich die Kommentare.',
    'اختر عنصرًا لتعديله. ستُفتح التعليقات إذا تعذّر التعديل المباشر.',
    'Select an element to edit. Comments will open if direct editing is unavailable.',
  ],
  撤销: ['Rückgängig', 'تراجع', 'Undo'],
  编辑元素: ['Element bearbeiten', 'تعديل العنصر', 'Edit element'],
  此元素仅支持批注: [
    'Für dieses Element sind nur Kommentare möglich',
    'هذا العنصر يدعم التعليقات فقط',
    'This element only supports comments',
  ],
  无法读取元素: [
    'Element konnte nicht geladen werden',
    'تعذّر تحميل العنصر',
    'Could not load element',
  ],
  保存失败: ['Speichern fehlgeschlagen', 'تعذّر الحفظ', 'Save failed'],
  撤销失败: ['Rückgängig machen fehlgeschlagen', 'تعذّر التراجع', 'Undo failed'],
  '{base} 已更新至 {head}。请在最新版本重新选择元素。': [
    '{base} wurde auf {head} aktualisiert. Wählen Sie das Element in der neuesten Version erneut aus.',
    'حُدّث {base} إلى {head}. أعد تحديد العنصر في أحدث إصدار.',
    '{base} has been updated to {head}. Select the element again in the latest version.',
  ],
  '已保存，新版本为 {version}': [
    'Gespeichert als {version}',
    'حُفظ كإصدار {version}',
    'Saved as {version}',
  ],
  '已撤销，新版本为 {version}': [
    'Rückgängig gemacht. Neue Version: {version}',
    'تم التراجع. الإصدار الجديد: {version}',
    'Undone. The new version is {version}',
  ],
} as const satisfies Messages
