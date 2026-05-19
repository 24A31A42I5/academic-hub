import React from 'react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Global error boundary. Prevents the whole app from white-screening when
 * an uncaught render error occurs. Logs the error and offers a recovery action.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('Unhandled UI error', { error: error.message, stack: error.stack, info });
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.assign('/');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-lg space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. You can try again, or return to the home page.
          </p>
          <pre className="text-xs text-left bg-muted rounded p-3 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={this.handleReset}>Try again</Button>
            <Button onClick={this.handleReload}>Go home</Button>
          </div>
        </div>
      </div>
    );
  }
}
