"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import ErrorBoundary from "@/components/ErrorBoundary";
import EmptyState from "@/components/EmptyState";

type Message = {
  id?: string;
  client_id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  isError?: boolean;
};

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = supabaseClient();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiBase = apiUrl ? apiUrl.replace(/\/$/, "") + "/v1" : null;
  
  const chatId = searchParams.get("id");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const oldestCursorRef = useRef<string | null>(null);
  const [health, setHealth] = useState<"ok" | "degraded" | "error" | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const formatTimestamp = useCallback((value?: string) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  }, []);

  const generateChatTitle = useCallback((text: string) => {
    const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
    return words.length > 0 ? words : "New chat";
  }, []);

  const fetchMessages = useCallback(async (loadMore = false) => {
    if (!chatId) {
      setMessages([]);
      setHasMore(false);
      setOldestCursor(null);
      oldestCursorRef.current = null;
      return;
    }
    if (!apiBase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/login");
    const cursor = oldestCursorRef.current;
    const beforeParam = loadMore && cursor ? `&before=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`${apiBase}/chats/${chatId}/messages?limit=50${beforeParam}`, {
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
      },
    });
    if (!res.ok) return;
    const payload = await res.json();
    const incoming = (payload?.messages || []) as Message[];
    if (loadMore) {
      setMessages((prev) => [...incoming, ...prev]);
    } else {
      setMessages(incoming);
    }
    if (incoming.length > 0) {
      const nextCursor = incoming[0]?.created_at || cursor;
      setOldestCursor(nextCursor);
      oldestCursorRef.current = nextCursor;
    }
    setHasMore(incoming.length === 50);
  }, [chatId, apiBase, supabase, router]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
        if (!res.ok) throw new Error("Health check failed");
        const payload = await res.json();
        if (!cancelled) setHealth(payload?.status || "ok");
      } catch {
        if (!cancelled) setHealth("error");
      }
    };
    checkHealth();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push("/login");
    });
    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, [supabase, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/dashboard");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const handleSend = async (overrideMessage?: string) => {
    const messageToSend = overrideMessage ?? input.trim();
    if (!messageToSend || isLoading || isCreatingChat) return;
    
    if (health === "degraded" || health === "error") {
      setToast("Cannot send message: backend services are unavailable");
      return;
    }
    
    const userMessage = messageToSend.trim();
    setInput("");
    setIsLoading(true);
    setLastFailedMessage(null);

    try {
      const clientId = `temp-${Date.now()}`;
      setMessages((prev) => [...prev, { role: "user", content: userMessage, client_id: clientId, created_at: new Date().toISOString() }]);

      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      if (!user || !session) return router.push("/login");

      let currentChatId = chatId;
      if (!currentChatId) {
        setIsCreatingChat(true);
        if (!apiBase) throw new Error("Missing API URL");
        const createRes = await fetch(`${apiBase}/chats`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ title: "New chat" }),
        });
        if (!createRes.ok) throw new Error("Failed to create chat");
        const payload = await createRes.json();
        currentChatId = payload?.chat?.id;
        if (!currentChatId) throw new Error("Invalid chat response");

        router.push(`/dashboard?id=${currentChatId}`);
        router.refresh();
        setIsCreatingChat(false);
      }

      const response = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: userMessage,
          chat_id: currentChatId,
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch response");
      const payload = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: payload?.response || "", created_at: new Date().toISOString() }]);
      if (currentChatId && apiBase) {
        const newTitle = generateChatTitle(userMessage);
        await fetch(`${apiBase}/chats/${currentChatId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ title: newTitle, only_if_default: true })
        });
        window.dispatchEvent(new Event("nyayagpt:refresh-chats"));
      }
      await fetchMessages();
      if (!chatId) router.refresh();
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: Unable to connect to the legal AI.", isError: true, created_at: new Date().toISOString() }]);
      setLastFailedMessage(userMessage);
    } finally {
      setIsLoading(false);
      setIsCreatingChat(false);
    }
  };

  const handleRetry = async () => {
    if (!lastFailedMessage) return;
    const retryMessage = lastFailedMessage;
    setLastFailedMessage(null);
    await handleSend(retryMessage);
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setToast("Copied to clipboard");
    } catch {
      setToast("Copy failed");
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-hide md:px-10">
          {!apiBase && (
            <div className="mb-4 rounded-lg border border-border bg-red-500/10 px-4 py-2 text-sm text-red-300">
              Missing API configuration. Set NEXT_PUBLIC_API_URL in frontend/.env.
            </div>
          )}
          {health && health !== "ok" && (
            <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              ⚠️ Backend services are unavailable. Chat is disabled until services are restored.
            </div>
          )}
          {toast && (
            <div className="mb-4 rounded-lg border border-border bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
              {toast}
            </div>
          )}
          {lastFailedMessage && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-red-500/10 px-4 py-2 text-sm text-red-300">
              <span>Last message failed. You can retry.</span>
              <button
                onClick={handleRetry}
                className="rounded-md border border-border px-3 py-1 text-xs text-white"
              >
                Retry
              </button>
            </div>
          )}
          {hasMore && (
            <div className="mb-4 flex justify-center">
              <button
                onClick={() => fetchMessages(true)}
                className="rounded-md border border-border px-4 py-2 text-xs text-muted hover:text-white"
              >
                Load more
              </button>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && !isLoading && !isCreatingChat && <EmptyState />}
            {messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id || msg.client_id || idx}
                role={msg.role}
                content={msg.content}
                createdAt={formatTimestamp(msg.created_at)}
                isError={msg.isError}
                onCopy={() => handleCopy(msg.content)}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-border bg-[#0b0f14] p-4 pb-6 md:px-10">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={isLoading || isCreatingChat || health === "degraded" || health === "error"}
              isLoading={isLoading}
            />
            <p className="mt-2 text-center text-xs text-muted">
              NyayaGPT can make mistakes. Please verify important legal information.
            </p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}