import * as AkashaKit from '@akasha/kit'
import * as Inkline from '@violetjs/inkline'
import * as InklineDom from '@violetjs/inkline/dom'
import * as LucideReact from 'lucide-react'
import * as Marked from 'marked'
import mermaid from 'mermaid'
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as Recharts from 'recharts'
import * as Shiki from 'shiki'
import { usePersistentControl as usePersistentControlHook } from '../state/preserve'
import { useArtifactState as useArtifactStateHook } from '../state/store'

const AkashaRuntime = {
  useArtifactState: useArtifactStateHook,
  usePersistentControl: usePersistentControlHook,
}

/**
 * 沙盒预打包的白名单模块表，键与服务端声明的依赖白名单一致。
 *
 * @remarks 运行时不请求外部 CDN；Artifact 的 import 被改写为对这张表的同步读取。
 */
export const SANDBOX_MODULES: Record<string, unknown> = {
  react: { ...React, default: React },
  'react-dom': { ...ReactDom, default: ReactDom },
  'react/jsx-runtime': ReactJsxRuntime,
  'lucide-react': LucideReact,
  recharts: Recharts,
  shiki: Shiki,
  marked: Marked,
  mermaid: { default: mermaid, mermaid },
  '@violetjs/inkline': Inkline,
  '@violetjs/inkline/dom': InklineDom,
  '@akasha/kit': {
    ...AkashaKit,
    useArtifactState: useArtifactStateHook,
    usePersistentControl: usePersistentControlHook,
  },
  '@akasha/runtime': AkashaRuntime,
}

interface SandboxGlobalScope {
  __AKASHA_MODULES__?: Record<string, unknown>
  useArtifactState?: typeof useArtifactStateHook
  usePersistentControl?: typeof usePersistentControlHook
}

/** 把模块表与两个状态 Hook 挂到全局，供编译后的 Artifact 代码读取。 */
export function installSandboxGlobals(): void {
  const scope = globalThis as unknown as SandboxGlobalScope
  scope.__AKASHA_MODULES__ = SANDBOX_MODULES
  scope.useArtifactState = useArtifactStateHook
  scope.usePersistentControl = usePersistentControlHook
}

export function isWhitelistedModule(specifier: string): boolean {
  return Object.hasOwn(SANDBOX_MODULES, specifier)
}
