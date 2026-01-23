"use client";

import { SendHorizonal } from "lucide-react";
import { useEffect, useRef } from "react";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  isLoading?: boolean;
};

export default function ChatInput({ value, onChange, onSend, disabled, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const maxLength = 2000;

  // Auto-resize textarea height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <div className="relative w-full rounded-2xl border border-border bg-surface/70 px-4 py-3 transition-colors focus-within:border-primary/50 focus-within:bg-surface">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!disabled && value.trim()) {
              onSend();
            }
          }
        }}
        rows={1}
        placeholder="Ask about IPC, CrPC, or the Constitution..."
        maxLength={maxLength}
        className="max-h-[200px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted/50 scrollbar-hide"
        disabled={disabled}
        aria-label="Chat message"
      />
      
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[10px] text-muted">
          {value.length}/{maxLength}
        </div>
        
        <button
          onClick={() => onSend()}
          disabled={disabled || !value.trim()}
          className={`rounded-full p-2 text-white transition-all ${
            disabled || !value.trim() 
              ? "bg-primary/20 opacity-50 cursor-not-allowed" 
              : "bg-primary hover:bg-primary/90 shadow-md"
          }`}
          aria-label="Send message"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}