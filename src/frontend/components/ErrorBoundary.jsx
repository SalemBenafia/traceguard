import React from 'react';
import { errorMessage, StatusMessage } from './StatusMessage';

const RENDER_ERROR = 'TraceGuard could not display this section, so reload the page to try again.';

// React only supports catching render errors in a class component.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error(`[TG] Render failed: ${error.message}`);
  }

  render() {
    if (this.state.hasError) return <StatusMessage message={errorMessage(RENDER_ERROR)} />;
    return this.props.children;
  }
}
