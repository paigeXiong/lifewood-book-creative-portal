import { Component, type ErrorInfo, type ReactNode } from "react";

export type AppErrorBoundaryLabels = {
  title: string;
  description: string;
  reload: string;
};

type Props = {
  children: ReactNode;
  labels: AppErrorBoundaryLabels;
};

type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error("Unexpected UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error-boundary" role="alert">
        <section>
          <span aria-hidden="true">!</span>
          <h1>{this.props.labels.title}</h1>
          <p>{this.props.labels.description}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {this.props.labels.reload}
          </button>
        </section>
      </main>
    );
  }
}
