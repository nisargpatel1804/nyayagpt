"use client";

import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import SidebarWrapper from "@/components/SidebarWrapper";

export default function DashboardShell({
  initialChats,
  children
}: {
  initialChats: any[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-white">
      <div className="hidden w-64 md:flex">
        <SidebarWrapper initialChats={initialChats || []} />
      </div>

      <div className="flex w-full flex-col md:hidden">
        <div className="flex items-center justify-between border-b border-border bg-surface/70 px-4 py-3">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md border border-border px-3 py-2 text-sm"
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">NyayaGPT</span>
        </div>

        {open && (
          <div className="fixed inset-0 z-50 flex">
            <div className="w-72 bg-background">
              <SidebarWrapper initialChats={initialChats || []} onNavigate={() => setOpen(false)} />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 bg-black/50"
              aria-label="Close sidebar"
            >
              <span className="sr-only">Close</span>
            </button>
            <button
              onClick={() => setOpen(false)}
              className="absolute left-72 top-3 rounded-md border border-border bg-surface px-2 py-2"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden">{children}</div>
      </div>

      <div className="hidden flex-1 flex-col md:flex">{children}</div>
    </div>
  );
}
