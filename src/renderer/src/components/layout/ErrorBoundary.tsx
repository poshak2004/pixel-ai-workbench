import { Component, type ReactNode } from 'react';
import { Button } from '../ui/primitives';

/** Contains render errors to the current page so one bug never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-8 max-w-2xl rounded-[6px] border border-verm/40 bg-verm-soft p-5" role="alert">
        <div className="font-mono text-[10.5px] tracking-[0.14em] text-verm uppercase">Something went wrong on this page</div>
        <pre className="mt-2 font-mono text-[12px] whitespace-pre-wrap text-ink" data-selectable>{this.state.error.message}</pre>
        <p className="mt-2 text-[12px] text-ink-2">Other pages still work. Your data is safe — nothing was lost.</p>
        <Button className="mt-3" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
