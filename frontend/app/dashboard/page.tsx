"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import { Clock, MessageSquare, ShieldAlert, MapPin } from "lucide-react";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import EmptyState from "@/components/EmptyState";
import ErrorBoundary from "@/components/ErrorBoundary";
import TimelineTable from "@/components/TimelineTable";

type Message = { 
  id: string; 
  role: "user" | "assistant"; 
  content: string; 
  created_at?: string; 
  isTimeline?: boolean; 
  isError?: boolean;
};

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatIdParam = searchParams.get("id");
  const supabase = supabaseClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  // MODES: Standard, Timeline, Devil's Advocate
  const [mode, setMode] = useState<"standard" | "timeline" | "devils_advocate">("standard");
  const [jurisdiction, setJurisdiction] = useState("All India");

  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const autoScrollRef = useRef(true);
  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  const apiUrl = apiBase ? `${apiBase}/v1` : null;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const appendErrorMessage = (content: string) => {
    setMessages((p) => [
      ...p,
      {
        id: `err_${Date.now()}`,
        role: "assistant",
        content,
        isError: true,
        isTimeline: false
      }
    ]);
  };

  const setToastAndLog = (message: string, error?: unknown) => {
    setToast(message);
    if (error) {
      console.error("NyayaGPT error:", error);
    }
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // --- Load Chat History ---
  useEffect(() => {
    if (!chatIdParam) { 
      setMessages([]); 
      return; 
    }
    
    const fetchMsgs = async () => {
      setLoadingHistory(true);
      const { data } = await supabase.auth.getSession();
      if (!data.session || !apiUrl) return;
      
      try {
        const res = await fetch(`${apiUrl}/chats/${chatIdParam}/messages?limit=50`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        
        if (res.ok) {
          const payload = await res.json();
          // Detect if historical messages are timelines based on content heuristic
          const msgs = (payload.messages || []).reverse().map((m: any) => ({
            ...m,
            isTimeline: m.content.trim().startsWith("[") && m.content.includes('"Date"')
          }));
          const hasPending = messagesRef.current.some(m => !m.created_at || m.id.endsWith("_ai"));
          if (hasPending && msgs.length === 0) return;
          if (hasPending && loadingRef.current) {
            setMessages(prev => [...msgs, ...prev.filter(m => !m.created_at || m.id.endsWith("_ai"))]);
          } else {
            setMessages(msgs);
          }
          setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
        } else if (res.status === 404) {
          router.replace("/dashboard");
        } else if (res.status === 401) {
          router.replace("/login");
        } else {
          const errPayload = await res.json().catch(() => null);
          setToastAndLog(errPayload?.error || "Failed to load messages.");
        }
      } catch (e) { 
        setToastAndLog("Failed to load messages.", e);
      } finally {
        setLoadingHistory(false);
      }
    };
    
    fetchMsgs();
  }, [chatIdParam, apiUrl, router, supabase.auth]);

  useEffect(() => {
    const onScroll = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      autoScrollRef.current = atBottom;
    };
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onGlobalError = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      if (detail?.message) {
        setToastAndLog(`Error: ${detail.message}`);
      }
    };
    window.addEventListener("nyayagpt:global-error", onGlobalError as EventListener);
    return () => window.removeEventListener("nyayagpt:global-error", onGlobalError as EventListener);
  }, []);

  // --- Handle Send Logic ---
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    if (!apiUrl) {
      setToastAndLog("Error: API URL is not configured.");
      return;
    }

    const CHAT_CREATE_TIMEOUT_MS = 15000;
    const STREAM_IDLE_TIMEOUT_MS = 120000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller?.abort(), STREAM_IDLE_TIMEOUT_MS);
    };
    
    const userContent = input.trim();
    const currentMode = mode;
    const currentJurisdiction = jurisdiction;
    
    setInput("");
    setLoading(true);
    streamingContentRef.current = "";

    // 1. Optimistic Updates
    const tempId = Date.now().toString();
    setMessages(p => [...p, { id: tempId, role: "user", content: userContent }]);
    
    const aiMsgId = tempId + "_ai";
    setMessages(p => [...p, { 
      id: aiMsgId, 
      role: "assistant", 
      content: "", 
      isTimeline: currentMode === "timeline" 
    }]);
    
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Unauthorized");
      const token = data.session.access_token;
      controller = new AbortController();
      abortRef.current = controller;
      cancelRequestedRef.current = false;

      // 2. Create Chat if Needed (Ghost Chat Prevention)
      let currentChatId = chatIdParam;
      if (!currentChatId) {
        const createController = new AbortController();
        const createTimeout = setTimeout(() => createController.abort(), CHAT_CREATE_TIMEOUT_MS);
        const cRes = await fetch(`${apiUrl}/chats`, {
          method: "POST", 
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: userContent.slice(0, 30) }),
          signal: createController.signal
        });
        clearTimeout(createTimeout);
        
        if (!cRes.ok) {
          const errPayload = await cRes.json().catch(() => null);
          throw new Error(errPayload?.error || `Failed to create chat (${cRes.status})`);
        }
        
        const cData = await cRes.json();
        currentChatId = cData.chat.id;
        
        // Sync URL without reload
        window.history.replaceState(null, "", `/dashboard?id=${currentChatId}`);
        // Notify Sidebar
        window.dispatchEvent(new Event("nyayagpt:refresh-chats"));
      }

      // 3. Start Streaming Request
      resetTimeout();
      const res = await fetch(`${apiUrl}/chat`, {
        method: "POST", 
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          chat_id: currentChatId, 
          message: userContent, 
          mode: currentMode,
          jurisdiction: currentJurisdiction
        }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        const errPayload = await res.json().catch(() => null);
        throw new Error(errPayload?.error || `Stream failed (${res.status})`);
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedAnyToken = false;

      // 4. Stream Loop
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        resetTimeout();
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            
            if (json.type === "token") {
              streamingContentRef.current += json.content;
              receivedAnyToken = true;
              
              setMessages(p => p.map(m => 
                m.id === aiMsgId ? { ...m, content: streamingContentRef.current } : m
              ));
              
              // Only auto-scroll if user hasn't scrolled up significantly
              if (autoScrollRef.current) {
                bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
              }
            } 
            else if (json.type === "end" && json.warning) {
              setToast("⚠️ Response generated, but history save failed.");
            }
            else if (json.type === "error") {
              setToast(`Error: ${json.content}`);
              setMessages(p => p.map(m =>
                m.id === aiMsgId ? { ...m, content: json.content, isError: true, isTimeline: false } : m
              ));
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    } catch (e: any) {
      const isAbort = e?.name === "AbortError";
      if (isAbort && cancelRequestedRef.current) {
        setToast("Cancelled.");
        if (!streamingContentRef.current) {
          setMessages(p => p.map(m =>
            m.id === aiMsgId
              ? { ...m, content: "Cancelled.", isError: false, isTimeline: false }
              : m
          ));
        }
      } else {
        const msg = isAbort ? "Error: Request timed out. Please try again." : `Error: ${e.message}`;
        setToastAndLog(msg, e);
        // If failed before any token received, replace placeholder with error
        if (!streamingContentRef.current) {
          setMessages(p => p.map(m =>
            m.id === aiMsgId
              ? { ...m, content: msg.replace(/^Error:\s*/i, ""), isError: true, isTimeline: false }
              : m
          ));
          setInput(userContent);
        }
      }
    } finally { 
      if (timeoutId) clearTimeout(timeoutId);
      abortRef.current = null;
      setLoading(false); 
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      cancelRequestedRef.current = true;
      abortRef.current.abort();
    }
  };

  // Toast Timer
  useEffect(() => { 
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000); 
      return () => clearTimeout(t);
    }
  }, [toast]);

  // --- Helper for Mode Buttons ---
  const ModeButton = ({ id, icon: Icon, label, activeColor }: any) => (
    <button
      onClick={() => setMode(id)}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition border ${
        mode === id 
          ? `${activeColor} border-transparent text-white shadow-sm` 
          : "bg-surface border-border text-muted hover:bg-white/5"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <ErrorBoundary>
      <div className="relative flex h-full flex-col bg-[#0b0f14]">
        {/* Toast Notification */}
        {toast && (
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-surface border border-border px-4 py-3 text-sm shadow-xl text-amber-400 animate-in fade-in slide-in-from-top-2">
            {toast}
          </div>
        )}
        
        {/* Chat Area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 scrollbar-hide md:p-6">
          {!chatIdParam && messages.length === 0 ? (
            <div className="mt-10 md:mt-20">
              <EmptyState />
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map(msg => (
                <div key={msg.id}>
                  {/* If Timeline Mode, render Table. Else render ChatMessage */}
                  {msg.isTimeline && msg.role === "assistant" ? (
                    <TimelineTable content={msg.content} />
                  ) : (
                    <ChatMessage 
                      role={msg.role} 
                      content={msg.content} 
                      createdAt={msg.created_at} 
                      isError={msg.isError}
                      onCopy={() => navigator.clipboard.writeText(msg.content)}
                    />
                  )}
                </div>
              ))}
              
              {/* Typing Indicator */}
              {loading && !streamingContentRef.current && !loadingHistory && (
                 <div className="flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm text-muted w-fit animate-pulse">
                   <span>Thinking...</span>
                 </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Footer: Controls & Input */}
        <div className="border-t border-border bg-[#0b0f14]/80 backdrop-blur-md p-4 md:p-6 pb-8">
          <div className="mx-auto max-w-3xl space-y-4">
            
            {/* Control Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Modes */}
              <div className="flex flex-wrap gap-2">
                <ModeButton id="standard" icon={MessageSquare} label="Standard" activeColor="bg-primary" />
                <ModeButton id="timeline" icon={Clock} label="Timeline" activeColor="bg-emerald-600" />
                <ModeButton id="devils_advocate" icon={ShieldAlert} label="Devil's Advocate" activeColor="bg-red-600" />
              </div>
              
              {/* Jurisdiction Dropdown */}
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 w-fit">
                <MapPin className="h-3 w-3 text-muted" />
                <select 
                  value={jurisdiction} 
                  onChange={(e) => setJurisdiction(e.target.value)}
                  className="bg-transparent text-xs text-white outline-none cursor-pointer"
                >
                  <option value="All India">All India</option>
                  <option value="Maharashtra">Maharashtra</option>
                  <option value="Uttar Pradesh">Uttar Pradesh</option>
                  <option value="Karnataka">Karnataka</option>
                  <option value="Delhi">Delhi</option>
                </select>
              </div>
            </div>

            {/* Input Component */}
            <ChatInput 
              value={input} 
              onChange={setInput} 
              onSend={handleSend} 
              onCancel={handleCancel}
              disabled={loading} 
              disableInput={false}
              isLoading={loading} 
            />
            
            {/* Helper Text */}
            <p className="text-center text-[10px] text-muted transition-all">
              {mode === "devils_advocate" ? "⚠️ Mode Active: The AI will aggressively counter your arguments." : 
               mode === "timeline" ? "Paste case details to generate a chronology." :
               "NyayaGPT can make mistakes. Verify important legal information."}
            </p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}