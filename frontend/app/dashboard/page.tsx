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
};

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatIdParam = searchParams.get("id");
  const supabase = supabaseClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  // MODES: Standard, Timeline, Devil's Advocate
  const [mode, setMode] = useState<"standard" | "timeline" | "devils_advocate">("standard");
  const [jurisdiction, setJurisdiction] = useState("All India");

  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") + "/v1";

  // --- Load Chat History ---
  useEffect(() => {
    if (!chatIdParam) { 
      setMessages([]); 
      return; 
    }
    
    const fetchMsgs = async () => {
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
          setMessages(msgs);
          setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
        } else if (res.status === 404) {
          router.replace("/dashboard");
        }
      } catch (e) { 
        console.error("Failed to fetch messages:", e); 
      }
    };
    
    fetchMsgs();
  }, [chatIdParam, apiUrl, router, supabase.auth]);

  // --- Handle Send Logic ---
  const handleSend = async () => {
    if (!input.trim() || loading || !apiUrl) return;
    
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

      // 2. Create Chat if Needed (Ghost Chat Prevention)
      let currentChatId = chatIdParam;
      if (!currentChatId) {
        const cRes = await fetch(`${apiUrl}/chats`, {
          method: "POST", 
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: userContent.slice(0, 30) }),
        });
        
        if (!cRes.ok) throw new Error("Failed to create chat");
        
        const cData = await cRes.json();
        currentChatId = cData.chat.id;
        
        // Sync URL without reload
        window.history.replaceState(null, "", `/dashboard?id=${currentChatId}`);
        // Notify Sidebar
        window.dispatchEvent(new Event("nyayagpt:refresh-chats"));
      }

      // 3. Start Streaming Request
      const res = await fetch(`${apiUrl}/chat`, {
        method: "POST", 
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          chat_id: currentChatId, 
          message: userContent, 
          mode: currentMode,
          jurisdiction: currentJurisdiction
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // 4. Stream Loop
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            
            if (json.type === "token") {
              streamingContentRef.current += json.content;
              
              setMessages(p => p.map(m => 
                m.id === aiMsgId ? { ...m, content: streamingContentRef.current } : m
              ));
              
              // Only auto-scroll if user hasn't scrolled up significantly
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            } 
            else if (json.type === "end" && json.warning) {
              setToast("⚠️ Response generated, but history save failed.");
            }
            else if (json.type === "error") {
              setToast(`Error: ${json.content}`);
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    } catch (e: any) {
      setToast(`Error: ${e.message}`);
      // If failed before any token received, remove the placeholder
      if (!streamingContentRef.current) {
        setMessages(p => p.filter(m => m.id !== aiMsgId));
        setInput(userContent);
      }
    } finally { 
      setLoading(false); 
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
        <div className="flex-1 overflow-y-auto p-4 scrollbar-hide md:p-6">
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
                      onCopy={() => navigator.clipboard.writeText(msg.content)}
                    />
                  )}
                </div>
              ))}
              
              {/* Typing Indicator */}
              {loading && !streamingContentRef.current && (
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
              disabled={loading} 
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