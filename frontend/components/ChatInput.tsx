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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <div className="relative w-full rounded-2xl border border-border bg-surface/70 px-4 py-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSend();
          }
        }}
        rows={1}
        placeholder="Ask about IPC, CrPC, or the Constitution..."
        className="w-full resize-none bg-transparent text-sm outline-none"
        disabled={disabled}
        aria-label="Chat message"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="absolute bottom-3 right-3 rounded-full bg-primary p-2 text-white disabled:opacity-50"
        aria-label="Send message"
      >
        <SendHorizonal className="h-4 w-4" />
      </button>
    </div>
  );
}
