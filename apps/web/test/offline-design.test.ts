// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { composeOfflineDesign } from '../src/features/export-design/offline-design'

it('即使是后续画板内隐藏的外部资源，也在请求运行器前阻止下载并指出具体画板', async () => {
  const board = { id: 'first', width: 360, height: 640, title: '起始', type: 'html' as const }
  await expect(
    composeOfflineDesign(
      {
        title: '预订流程',
        version: 1,
        flows: [{ from: 'first', to: 'second' }],
        boards: [
          { ...board, source: '<p>自包含首页</p>' },
          {
            ...board,
            id: 'second',
            title: '完成',
            source: '<style>@media (width > 1000px) {button {background:url(/bg.png)}}</style>',
          },
        ],
      },
      false,
      new AbortController().signal,
      () => undefined,
    ),
  ).rejects.toThrow('「完成」：不能离线打包样式资源：/bg.png')
})
