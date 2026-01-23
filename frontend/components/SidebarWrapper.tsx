"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabaseClient } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

export default function SidebarWrapper({
  initialChats,
  onNavigate
}: {
  initialChats: any[];
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeChatId = searchParams.get("id");
  const supabase = supabaseClient();
  
  const [chats, setChats] = useState(initialChats || []);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newChatLocked, setNewChatLocked] = useState(false); 
  
  const cursorRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);
  
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiBase = apiUrl ? apiUrl.replace(/\/$/, "") + "/v1" : null;
  const pageLimit = 50;

  // --- 1. Initialize State ---
  useEffect(() => {
    setChats([...(initialChats || [])]);
    setLoading((initialChats || []).length === 0);
    setHasMore((initialChats || []).length >= pageLimit);
    const last = (initialChats || [])[(initialChats || []).length - 1];
    cursorRef.current = last?.created_at || null;
  }, [initialChats]);

  // --- 2. Auth Listener ---
  // Simplified to avoid fighting Middleware. 
  // We rely on Middleware for hard redirects, and this for client-side cleanup.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setChats([]);
        router.push("/login");
      }
    });
    return () => { listener?.subscription?.unsubscribe(); };
  }, [supabase, router]);

  const handleSelectChat = (chatId: string) => {
    router.push(`/dashboard?id=${chatId}`);
    onNavigate?.();
  };

  // --- 3. Ghost Chat Prevention (Debounce) ---
  const handleNewChat = useCallback(() => {
    if (newChatLocked) return;
    setNewChatLocked(true);
    
    // Optimistically navigate to root
    router.push("/dashboard"); 
    onNavigate?.();

    // Lock interaction for 1 second to prevent double-creation clicks
    setTimeout(() => setNewChatLocked(false), 1000);
  }, [newChatLocked, router, onNavigate]);

  // --- 4. Session Validation ---
  const getValidSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    // If no session, return null and let Middleware handle the redirect logic
    // rather than forcing a push here which causes loops.
    if (!session) return null; 
    return session;
  }, [supabase]);

  // --- 5. Data Fetching ---
  const refreshChats = useCallback(async () => {
    if (!apiBase || isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    
    try {
      const session = await getValidSession();
      if (!session) return;

      const res = await fetch(`${apiBase}/chats?limit=${pageLimit}`, {
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      
      if (res.ok) {
        const payload = await res.json();
        const nextChats = payload?.chats || [];
        setChats(nextChats);
        setHasMore(nextChats.length >= pageLimit);
        const last = nextChats[nextChats.length - 1];
        cursorRef.current = last?.created_at || null;
      }
    } catch (e) {
      console.error("Refresh failed", e);
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;
    }
  }, [apiBase, getValidSession]);

  const loadMoreChats = useCallback(async () => {
    if (!apiBase || !hasMore || loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const session = await getValidSession();
      if (!session) return;

      const res = await fetch(`${apiBase}/chats?limit=${pageLimit}&before=${encodeURIComponent(cursorRef.current)}`, {
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      
      if (res.ok) {
        const payload = await res.json();
        const next = payload?.chats || [];
        if (next.length === 0) {
            setHasMore(false);
        } else {
            setChats(prev => [...prev, ...next]);
            const last = next[next.length - 1];
            cursorRef.current = last?.created_at || cursorRef.current;
        }
      }
    } finally {
      setLoadingMore(false);
    }
  }, [apiBase, hasMore, loadingMore, getValidSession]);

  // Listen for global refresh events (triggered by DashboardPage on new chat creation)
  useEffect(() => {
    const handler = () => refreshChats();
    window.addEventListener("nyayagpt:refresh-chats", handler);
    return () => window.removeEventListener("nyayagpt:refresh-chats", handler);
  }, [refreshChats]);

  // --- 6. Safe Deletion Logic ---
  const handleDeleteChat = async (chatId: string) => {
    if (!apiBase) return;
    const session = await getValidSession();
    if (!session) return;

    if (!window.confirm("Delete this chat and all messages?")) return;

    const previousChats = [...chats];
    // Optimistic Update: Remove immediately
    setChats(prev => prev.filter(c => c.id !== chatId));
    
    if (activeChatId === chatId) {
        router.replace("/dashboard");
    }

    try {
      const res = await fetch(`${apiBase}/chats/${chatId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      
      if (res.ok) {
        setToast("Chat deleted");
        // Notify other components if needed
        window.dispatchEvent(new CustomEvent("nyayagpt:chat-deleted", { detail: { chatId } }));
      } else {
        throw new Error("Delete failed");
      }
    } catch (error) {
      // Rollback on failure (prevents Zombie chats)
      setChats(previousChats);
      setToast("Failed to delete. Restored chat.");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleExportChat = async (chatId: string) => {
    if (!apiBase) return;
    const session = await getValidSession();
    if (!session) return;

    setToast("Preparing export...");
    try {
        const res = await fetch(`${apiBase}/chats/${chatId}/messages?limit=1000`, {
            headers: { "Authorization": `Bearer ${session.access_token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data.messages, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `nyayagpt-chat-${chatId}.json`;
            link.click();
            URL.revokeObjectURL(url);
            setToast("Chat exported");
        } else {
            setToast("Export failed");
        }
    } catch (e) {
        setToast("Export failed");
    }
  };

  // Toast Timer
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="relative h-full">
      {toast && (
        <div className="absolute left-4 right-4 top-4 z-20 rounded-lg border border-border bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onLogout={handleLogout}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        onLoadMore={loadMoreChats}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loading={loading}
        disableActions={messagesLoading}
        disableNewChat={newChatLocked}
      />
    </div>
  );
}