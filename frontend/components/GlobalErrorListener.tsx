"use client";

import { useEffect } from "react";

type GlobalErrorPayload = {
  message: string;
  source?: "error" | "unhandledrejection";
};

export default function GlobalErrorListener() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const message = event.error?.message || event.message || "Unexpected error";
      window.dispatchEvent(
        new CustomEvent<GlobalErrorPayload>("nyayagpt:global-error", {
          detail: { message, source: "error" }
        })
      );
      console.error("NyayaGPT global error:", message);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason?.message || String(event.reason || "Unhandled rejection");
      window.dispatchEvent(
        new CustomEvent<GlobalErrorPayload>("nyayagpt:global-error", {
          detail: { message, source: "unhandledrejection" }
        })
      );
      console.error("NyayaGPT unhandled rejection:", message);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
