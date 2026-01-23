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

  // Close sidebar on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-white">
      {/* Desktop Sidebar (Hidden on Mobile) */}
      <div className="hidden w-64 md:flex md:flex-col border-r border-border bg-surface/50">
        <SidebarWrapper initialChats={initialChats || []} />
      </div>

      {/* Mobile Layout */}
      <div className="flex w-full flex-col md:hidden">
        {/* Mobile Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md px-4 py-3 sticky top-0 z-30">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md border border-border p-2 text-muted hover:text-white hover:bg-white/5 active:bg-white/10 transition-colors"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-wide">NyayaGPT</span>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Mobile Sidebar Overlay */}
        {open && (
          <div className="fixed inset-0 z-50 flex">
            {/* Sidebar Content */}
            <div className="w-72 bg-surface shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between border-b border-border p-4">
                <span className="font-semibold">Menu</span>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-muted hover:text-white hover:bg-white/5"
                  aria-label="Close sidebar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="h-[calc(100%-60px)]">
                <SidebarWrapper 
                  initialChats={initialChats || []} 
                  onNavigate={() => setOpen(false)} 
                />
              </div>
            </div>
            
            {/* Backdrop (Click to close) */}
            <div 
              onClick={() => setOpen(false)}
              className="flex-1 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
              aria-label="Close sidebar"
            />
          </div>
        )}

        {/* Main Content Area (Mobile) */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </div>

      {/* Desktop Main Content Area */}
      <div className="hidden flex-1 flex-col md:flex overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}