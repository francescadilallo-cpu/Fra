import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
  errorInfo: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ errorInfo: info.componentStack })
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', error, info)
  }

  reset = () => this.setState({ error: null, errorInfo: '' })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-red-100 shadow-xl p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
              <p className="text-sm text-slate-500 mt-1.5">
                An unexpected error occurred. Your data is safe.
              </p>
            </div>
            <details className="text-left">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                Technical details
              </summary>
              <pre className="mt-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto max-h-32 text-slate-600">
                {this.state.error.message}
                {this.state.errorInfo && `\n\nComponent stack:${this.state.errorInfo}`}
              </pre>
            </details>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.reset}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Home className="w-4 h-4" /> Reload app
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
