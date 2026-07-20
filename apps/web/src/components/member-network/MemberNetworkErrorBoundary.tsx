'use client';

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import styles from './member-network.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryVersion: number;
}

/** Keeps a malformed network response local to the member workspace. */
export class MemberNetworkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retryVersion: 0 };

  static getDerivedStateFromError(): Pick<State, 'hasError'> {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The API adapter handles expected payload errors. This boundary prevents an
    // unexpected render fault from replacing the authenticated application shell.
  }

  private retry = () => {
    this.setState((state) => ({ hasError: false, retryVersion: state.retryVersion + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className={styles.fatalState} role="alert">
          <span className={styles.fatalEyebrow}>Network view paused</span>
          <h1>Your network could not be displayed</h1>
          <p>The rest of your account is still available. Reload this protected view to try again.</p>
          <button type="button" className={styles.retryButton} onClick={this.retry}>
            Try again
          </button>
        </section>
      );
    }
    // A changed fragment key unmounts the failed workspace and starts its
    // snapshot-fetch effect again instead of only clearing the fallback UI.
    return <Fragment key={this.state.retryVersion}>{this.props.children}</Fragment>;
  }
}
