"use client";

import { MessageSquarePlus, UserCircle2, Trash2, Download } from "lucide-react";
import { useMemo, useState, useEffect } from "react";

type ChatItem = {
  id: string;
  title: string;
};

type SidebarProps = {
  chats: ChatItem[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onLogout: () => void;
  onDeleteChat: (chatId: string) => void;
  onExportChat: (chatId: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loading?: boolean;
  disableActions?: boolean;
  disableNewChat?: boolean;
};

export default function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onLogout,
  onDeleteChat,
  onExportChat,
  onLoadMore,
  hasMore,
  loadingMore,
  loading,
  disableActions,
  disableNewChat
}: SidebarProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredChats = useMemo(() => {
    if (!debouncedSearch) return chats;
    const q = debouncedSearch.toLowerCase();
    return chats.filter((chat) => chat.title?.toLowerCase().includes(q));
  }, [debouncedSearch, chats]);

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface/60">
      <div className="p-4">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          disabled={disableActions || disableNewChat}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats..."
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder-muted focus:border-primary focus:outline-none transition-colors"
          aria-label="Search chats"
        />
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4 scrollbar-hide">
        {loading && (
          <div className="flex flex-col gap-2">
             {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
             ))}
          </div>
        )}
        {!loading && filteredChats.length === 0 && (
          <div className="py-4 text-center text-sm text-muted">
            {search ? "No chats found." : "No chats yet."}
          </div>
        )}
        {!loading && filteredChats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              activeChatId === chat.id 
                ? "bg-white/10 text-white font-medium" 
                : "text-muted hover:bg-white/5 hover:text-white"
            }`}
          >
            <button
              className="flex-1 truncate text-left"
              onClick={() => onSelectChat(chat.id)}
              disabled={disableActions}
              title={chat.title}
            >
              {chat.title}
            </button>
            
            <div className={`ml-2 flex items-center gap-1 ${activeChatId === chat.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id);
                }}
                className="rounded p-1.5 text-muted hover:bg-red-500/20 hover:text-red-400 transition-colors"
                aria-label="Delete chat"
                disabled={disableActions}
                title="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-white/5 hover:text-white disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
      
      <div className="border-t border-border p-4">
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu((prev) => !prev)}
            className={`flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors ${showProfileMenu ? "bg-white/10 text-white" : "text-muted hover:bg-white/5 hover:text-white"}`}
          >
            <UserCircle2 className="h-5 w-5" />
            <span className="flex-1 text-left">My Account</span>
          </button>
          
          {showProfileMenu && (
            <>
              {/* Click outside handler */}
              <div className="fixed inset-0 z-10" onClick={() => setShowProfileMenu(false)} />
              
              <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl animate-in slide-in-from-bottom-2 fade-in duration-200">
                {activeChatId && (
                  <button
                    onClick={() => {
                      onExportChat(activeChatId);
                      setShowProfileMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-muted hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <Download className="h-4 w-4" /> 
                    Export Chat
                  </button>
                )}
                <button
                  onClick={onLogout}
                  className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-border"
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}