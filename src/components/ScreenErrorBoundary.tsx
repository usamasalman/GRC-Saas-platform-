import React from 'react';

interface Props {
  /** The menu key of the screen inside, for the message and the log. */
  screen: string;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps one broken screen from taking the whole application down.
 *
 * Without it, an error thrown while a screen renders unmounts everything React
 * owns, and the person is left with an empty page and no menu to leave by
 * (QA-014: the user-management screen did exactly that for every administrator).
 * With it, the menu and the header stay, and the screen says what happened.
 *
 * The error is still logged, so the browser tests keep reporting the screen as
 * broken: this contains a defect, it does not hide one. Give it `key={screen}`
 * so moving to another screen starts clean.
 */
export default class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(`[screen:${this.props.screen}] failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="content" role="alert" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-muted)' }}>
        <h3 style={{ margin: '0 0 8px', color: 'var(--ink)' }}>This screen could not be shown</h3>
        <p style={{ fontSize: 13, margin: '0 0 16px' }}>
          Something went wrong while opening it. The rest of the application still works: choose another screen from the menu, or try this one again.
        </p>
        <button type="button" className="btn" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
