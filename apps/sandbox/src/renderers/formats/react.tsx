import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ArtifactCompileError, compileReactArtifact } from '../../runtime/compiler'
import type { RendererProps } from '../registry'

interface ErrorBoundaryProps {
  resetKey: string
  onError: RendererProps['onError']
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class ArtifactErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError({
      phase: 'runtime',
      message: error.message || String(error),
      stack: error.stack ?? info.componentStack ?? undefined,
    })
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p className="font-semibold">Artifact 运行时错误</p>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function ReactRenderer({ source, version, preserved, onError, onRendered }: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [compiled, setCompiled] = useState<{
    source: string
    version: number
    Component: ComponentType
  } | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    let cancelled = false
    setCompileError(null)

    compileReactArtifact(source)
      .then((LoadedComponent) => {
        if (cancelled) return
        setCompiled({ source, version, Component: LoadedComponent })
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        const loc = err instanceof ArtifactCompileError ? err.loc : undefined
        setCompileError(message)
        onErrorRef.current({
          phase: 'compile',
          message,
          stack: err instanceof Error ? err.stack : undefined,
          loc,
        })
      })

    return () => {
      cancelled = true
    }
  }, [source, version])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !compiled) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current(compiled.version)
    return cleanup
  }, [compiled, preserved])

  if (compileError) {
    return (
      <div
        role="alert"
        data-ak-renderer="react"
        className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <p className="font-semibold">编译失败</p>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {compileError}
        </pre>
      </div>
    )
  }

  const ActiveComponent = compiled?.Component

  return (
    <div ref={hostRef} data-ak-renderer="react" className="ak-react-root min-h-full">
      {ActiveComponent ? (
        <ArtifactErrorBoundary
          resetKey={`${version}:${source}`}
          onError={(err) => onErrorRef.current(err)}
        >
          <ActiveComponent />
        </ArtifactErrorBoundary>
      ) : (
        <div className="p-6 text-xs text-slate-400">正在编译 React Artifact…</div>
      )}
    </div>
  )
}
