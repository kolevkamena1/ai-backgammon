import { BUTTON } from '@/components/ui/controls'
import { logger } from '@/lib/logger'
import { cn } from '@/utils/cn'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

const PRIMARY = cn(BUTTON, 'bg-sky-600 px-3.5 py-2 text-sm text-white hover:bg-sky-500')
const SECONDARY = cn(BUTTON, 'border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-slate-100 hover:bg-slate-700')

/**
 * Last line of defence around the game tree. A render crash anywhere in `App` would otherwise blank
 * the whole page; this catches it, logs it through the redacting logger, and offers a way back.
 * Credentials are untouched — they live in localStorage, not in this component's state.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('app crashed', {
      message: error.message,
      componentStack: info.componentStack ?? '',
    })
  }

  handleRetry = (): void => {
    this.setState({ error: null })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400">
              <TriangleAlert className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-semibold text-slate-50">Something went wrong</h1>
              <p className="text-xs text-slate-400">The game hit an unexpected error.</p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Your settings and API key are safe in this browser. Try again, or reload to continue.
          </p>

          <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
            <summary className="cursor-pointer select-none font-medium text-slate-300">
              Error details
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {this.state.error.message}
            </pre>
          </details>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={this.handleRetry} className={SECONDARY}>
              Try again
            </button>
            <button type="button" onClick={this.handleReload} className={PRIMARY}>
              <RotateCcw className="size-4" aria-hidden />
              Reload the app
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary