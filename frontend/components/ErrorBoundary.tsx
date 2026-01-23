"use client";

import React from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("NyayaGPT UI error:", error?.message || error);
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary details:", errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="rounded-full bg-red-500/10 p-4 ring-1 ring-red-500/20">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">Something went wrong</h3>
            <p className="max-w-md text-sm text-muted">
              {this.state.error?.message || "An unexpected error occurred while rendering this view."}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5 hover:border-white/20"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}