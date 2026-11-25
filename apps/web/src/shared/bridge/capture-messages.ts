import type { Messages } from '../i18n/messages'

export const captureMessages = {
  '当前浏览器不能在安全上下文中渲染画板 PNG': [
    'Dieser Browser kann die Zeichenfläche nicht in einem sicheren Kontext als PNG rendern',
    'لا يستطيع هذا المتصفح تصيير اللوحة بصيغة PNG في سياق آمن',
    'This browser cannot render the artboard as a PNG in a secure context',
  ],
  '沙盒返回的 PNG 格式或尺寸不符': [
    'PNG-Format oder Abmessungen aus der Sandbox sind ungültig',
    'صيغة PNG أو أبعاد الصورة المُعادة من البيئة المعزولة غير صحيحة',
    'The sandbox returned an invalid PNG format or dimensions',
  ],
  画板渲染任务: ['Zeichenfläche rendern', 'مهمة تصيير اللوحة', 'Artboard rendering task'],
  静态画板不读取或修改制品运行存储: [
    'Statische Zeichenflächen lesen oder verändern keine Laufzeitdaten des Werks',
    'لا تقرأ اللوحات الثابتة بيانات تشغيل العمل ولا تعدّلها',
    'Static artboards do not read or modify artifact runtime storage',
  ],
} as const satisfies Messages
