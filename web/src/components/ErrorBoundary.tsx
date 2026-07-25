import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel, if supplied. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Stops one bad render from blanking the whole app.
 *
 * Without this a single throw — a malformed torrent payload, an unexpected
 * null — unmounts everything and leaves a white page with no way back short of
 * a manual reload. "Try again" clears the error and re-renders; the polling
 * queries pick straight back up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack in the console — the panel deliberately shows
    // only the message, since it may be read over someone's shoulder.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex items-center justify-center p-10">
        <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="text-red-400" size={22} />
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">Something broke rendering this view</h2>
          <p className="text-sm text-neutral-400 mt-2">
            The rest of Smuggler is still running — your downloads are unaffected.
          </p>
          <p className="mt-3 text-xs font-mono text-red-300/80 break-words">{error.message}</p>
          <button
            onClick={this.reset}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold text-white transition-colors"
          >
            <RotateCcw size={15} /> Try again
          </button>
        </div>
      </div>
    );
  }
}
