"use client";

import { MessageSquarePlus, UserCircle2, Pin, PinOff, Trash2, Download } from "lucide-react";
import { useMemo, useState } from "react";

type ChatItem = {
  id: string;
  title: string;
  pinned?: boolean;
};

type SidebarProps = {
  chats: ChatItem[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onLogout: () => void;
  onTogglePin: (chatId: string, pinned: boolean) => void;
  onDeleteChat: (chatId: string) => void;
  onExportChat: (chatId: string) => void;
  loading?: boolean;
};

export default function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onLogout,
  onTogglePin,
  onDeleteChat,
  onExportChat,
  loading
}: SidebarProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const filteredChats = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.toLowerCase();
    return chats.filter((chat) => chat.title?.toLowerCase().includes(q));
  }, [search, chats]);
  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface/60">
      <div className="p-4">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats..."
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white"
          aria-label="Search chats"
        />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4 scrollbar-hide">
        {loading && (
          <div className="rounded-lg border border-border bg-surface/60 px-3 py-4 text-sm text-muted">
            Loading chats...
          </div>
        )}
        {!loading && filteredChats.length === 0 && (
          <div className="rounded-lg border border-border bg-surface/60 px-3 py-4 text-sm text-muted">
            No chats found.
          </div>
        )}
        {!loading && filteredChats.map((chat) => (
          <div
            key={chat.id}
            className={`flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm transition ${
              activeChatId === chat.id ? "bg-white/10 text-white" : "text-muted hover:bg-white/5"
            }`}
          >
            <button className="text-left w-full text-sm" onClick={() => onSelectChat(chat.id)} aria-label="Open chat">
              {chat.title}
            </button>
            <div className="ml-2 flex items-center gap-1">
              <button
                onClick={() => onTogglePin(chat.id, !chat.pinned)}
                className="rounded-md border border-border p-1 text-muted hover:text-white"
                aria-label="Toggle pin"
              >
                {chat.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onDeleteChat(chat.id)}
                className="rounded-md border border-border p-1 text-muted hover:text-white"
                aria-label="Delete chat"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="relative border-t border-border p-4">
        <button
          onClick={() => setShowProfileMenu((prev) => !prev)}
          className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-white"
        >
          <UserCircle2 className="h-5 w-5" />
          Profile
        </button>
        {showProfileMenu && (
          <div className="absolute bottom-14 left-4 right-4 rounded-lg border border-border bg-surface p-2 shadow-lg">
            {activeChatId && (
              <button
                onClick={() => onExportChat(activeChatId)}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:text-white hover:bg-white/5"
              >
                <span className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" /> Export chat
                </span>
              </button>
            )}
            <button
              onClick={onLogout}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:text-white hover:bg-white/5"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
