"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiBase = apiUrl ? apiUrl.replace(/\/$/, "") + "/v1" : null;

  useEffect(() => {
    setChats([...(initialChats || [])]);
    setLoading(false);
  }, [initialChats]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      router.refresh();
    });
    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, [supabase, router]);

  const handleSelectChat = (chatId: string) => {
    router.push(`/dashboard?id=${chatId}`);
    onNavigate?.();
  };

  const handleNewChat = () => {
    router.push("/dashboard");
    onNavigate?.();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const refreshChats = async () => {
    if (!apiBase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${apiBase}/chats`, {
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
      }
    });
    if (res.ok) {
      const payload = await res.json();
      setChats(payload?.chats || []);
    }
  };

  useEffect(() => {
    const handler = () => {
      refreshChats();
    };
    window.addEventListener("nyayagpt:refresh-chats", handler);
    return () => window.removeEventListener("nyayagpt:refresh-chats", handler);
  }, [apiBase]);

  const handleTogglePin = async (chatId: string, pinned: boolean) => {
    if (!apiBase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${apiBase}/chats/${chatId}/pin`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ pinned })
    });
    if (res.ok) {
      setToast(pinned ? "Chat pinned" : "Chat unpinned");
      refreshChats();
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!apiBase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const confirmed = window.confirm("Delete this chat and all messages?");
    if (!confirmed) return;
    const res = await fetch(`${apiBase}/chats/${chatId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
      }
    });
    if (res.ok) {
      setToast("Chat deleted");
      if (activeChatId === chatId) {
        router.push("/dashboard");
      }
      refreshChats();
    }
  };

  const handleExportChat = async (chatId: string) => {
    if (!apiBase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${apiBase}/chats/${chatId}/messages?limit=200`, {
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
      }
    });
    if (!res.ok) return;
    const payload = await res.json();
    const blob = new Blob([JSON.stringify(payload?.messages || [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nyayagpt-chat-${chatId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("Chat exported");
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="relative h-full">
      {toast && (
        <div className="absolute left-4 right-4 top-4 z-10 rounded-lg border border-border bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {toast}
        </div>
      )}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onLogout={handleLogout}
        onTogglePin={handleTogglePin}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        loading={loading}
      />
    </div>
  );
}