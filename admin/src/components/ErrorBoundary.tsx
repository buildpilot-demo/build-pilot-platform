import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error">
        <div className="fatal-error__mark">!</div>
        <p className="eyebrow">Application error</p>
        <h1>Something went wrong</h1>
        <p className="muted">{this.state.error.message || "The console could not finish loading."}</p>
        <button className="button button--primary" onClick={() => window.location.reload()}>Reload console</button>
      </main>
    );
  }
}
