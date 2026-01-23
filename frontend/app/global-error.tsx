"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("NyayaGPT global error:", error?.message || error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-white">
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-full bg-red-500/10 p-4 ring-1 ring-red-500/20">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Critical error</h3>
            <p className="max-w-md text-sm text-muted">
              {error?.message || "The application encountered an unrecoverable error."}
            </p>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5 hover:border-white/20"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload app
          </button>
        </div>
      </body>
    </html>
  );
}
