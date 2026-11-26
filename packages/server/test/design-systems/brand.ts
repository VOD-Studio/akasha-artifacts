import type { DesignSystemDraft } from '@akasha/protocol'

// 自制 TrueType 字体，只含一个三角形 A 字形；示例不打包系统字体或第三方品牌资产。
const triangleFont =
  'AAEAAAAKAIAAAwAgT1MvMmBWTBcAAACsAAAATmNtYXAADAB0AAAA/AAAACxnbHlmh8EwgQAAASgAAAAaaGVhZGGWQ6EAAAFEAAAANmhoZWEFogHjAAABfAAAACRobXR4BVAAAAAAAaAAAAAIbG9jYQANAAAAAAGoAAAABm1heHAABAAEAAABsAAAACBuYW1lETAkLgAAAdAAAADkcG9zdP+4ADIAAAK0AAAAIAAAAqgBkAAFAAACigJYAAAASwKKAlgAAAFeADIA+gAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAABBS1NIAEAAQQBBAyD/OAAAAyAAyAAAAAAAAQADAAEAAAAMAAQAIAAAAAQABAABAAAAQf//AAAAQf///8AAAQAAAAAAAQAAAAACgAK8AAIAADEBAQFAAUACvP1EAAAAAAEAAAABAADaTs4XXw889QADA+gAAAAAAAAAAAAAAAAAAAAAAAAAAAKAArwAAAAIAAIAAAAAAAAAAQAAAyD/OAAAAqgAAAAAAoAAAQAAAAAAAAAAAAAAAAAAAAICqAAAAqgAAAAAAAAADQAAAAEAAAACAAMAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAFAEIAAwABBAkAAQAeAAAAAwABBAkAAgAOAB4AAwABBAkAAwAsACwAAwABBAkABAAeAFgAAwABBAkABgAsAHYAQQBrAGEAcwBoAGEAIABUAHIAaQBhAG4AZwBsAGUAUgBlAGcAdQBsAGEAcgBBAGsAYQBzAGgAYQBUAHIAaQBhAG4AZwBsAGUALQBSAGUAZwB1AGwAYQByAEEAawBhAHMAaABhACAAVAByAGkAYQBuAGcAbABlAEEAawBhAHMAaABhAFQAcgBpAGEAbgBnAGwAZQAtAFIAZQBnAHUAbABhAHIAAwAAAAAAAP+1ADIAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

export const brand: DesignSystemDraft = {
  origin: { kind: 'local', label: 'Triangle Foundry' },
  files: [
    {
      kind: 'logo',
      path: 'triangle.svg',
      content: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 30 30H2Z"/></svg>',
      ).toString('base64'),
    },
    { kind: 'font', path: 'Triangle.ttf', content: triangleFont },
    {
      kind: 'guidelines',
      path: 'brand.md',
      content: 'A — use the triangular mark at the start of the page.',
    },
    {
      kind: 'figma',
      path: 'identity.url',
      content: 'https://www.figma.com/design/triangle/Identity',
    },
  ],
  components: [],
  guidance: {
    instructions: 'Keep the wordmark on its own line.',
    fontFamily: 'Akasha Triangle',
    color: '#123456',
    spacing: 16,
  },
}

export function buttons(color: string): DesignSystemDraft {
  return {
    origin: { kind: 'github-checkout', label: 'triangle-foundry/ui' },
    files: [
      {
        kind: 'source',
        path: 'src/Button.tsx',
        content: `import {useState} from 'react';import './button.css';export function ConfirmButton({children}) { const [sent,setSent]=useState(false); return <button className="triangle-action" onClick={()=>setSent(true)}>{sent ? 'Sent from original' : children}</button> }`,
      },
      {
        kind: 'source',
        path: 'src/button.css',
        content: `.triangle-action { background-color:${color} }`,
      },
      {
        kind: 'source',
        path: 'src/Badge.tsx',
        content: `export default function Badge() { return <strong>Private badge implementation</strong> }`,
      },
    ],
    components: [
      { path: 'src/Button.tsx', exportName: 'ConfirmButton', props: { children: 'Confirm order' } },
      { path: 'src/Badge.tsx', exportName: 'default', props: {} },
    ],
    guidance: {
      instructions: 'Only use after agreement.',
      fontFamily: 'sans-serif',
      color: '#123456',
      spacing: 8,
    },
  }
}
