"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy } from "lucide-react";

type ChatMessageProps = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  isError?: boolean;
  onCopy?: () => void;
};

export default function ChatMessage({
  role,
  content,
  createdAt,
  isError,
  onCopy
}: ChatMessageProps) {
  const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [...(defaultSchema.attributes?.code || []), ["className"]],
      span: [...(defaultSchema.attributes?.span || []), ["className"]],
      pre: [...(defaultSchema.attributes?.pre || []), ["className"]]
    }
  };
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-white/10"
            : isError
              ? "bg-red-500/10 text-red-300"
              : "bg-transparent text-white/90"
        }`}
      >
        {isUser ? (
          <span>{content}</span>
        ) : (
          <ReactMarkdown
            className="prose-markdown"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeHighlight]}
          >
            {content}
          </ReactMarkdown>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
          <span>{createdAt || ""}</span>
          <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
            {onCopy && (
              <button
                onClick={onCopy}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-white"
                aria-label="Copy message"
              >
                <Copy className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
