"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import DOMPurify from "isomorphic-dompurify";
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
  // Sanitize user content strictly (plaintext mainly)
  const safeUserContent = useMemo(
    () => DOMPurify.sanitize(content, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }),
    [content]
  );

  // Schema for AI responses (allows formatting)
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div
        className={`group relative max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm transition-all ${
          isUser
            ? "bg-primary text-white"
            : isError
              ? "bg-red-500/10 text-red-300 border border-red-500/20"
              : "bg-surface text-white/90 border border-border"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{safeUserContent}</span>
        ) : (
          <ReactMarkdown
            className="prose-markdown break-words"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeHighlight]}
            components={{
              a: ({ node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />
              ),
              // Custom table styling for legal data
              table: ({ node, ...props }) => (
                <div className="my-4 w-full overflow-x-auto rounded-lg border border-border bg-black/20">
                  <table {...props} className="w-full text-left" />
                </div>
              ),
              th: ({ node, ...props }) => (
                <th {...props} className="border-b border-border bg-white/5 px-4 py-2 font-semibold" />
              ),
              td: ({ node, ...props }) => (
                <td {...props} className="border-b border-border/50 px-4 py-2" />
              )
            }}
          >
            {content}
          </ReactMarkdown>
        )}

        <div className={`mt-2 flex items-center gap-2 text-[10px] opacity-70 ${isUser ? "justify-end text-white/80" : "justify-between text-muted"}`}>
          <span>{createdAt}</span>
          
          {!isUser && onCopy && (
            <button
              onClick={onCopy}
              className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 hover:bg-white/10 opacity-0 transition group-hover:opacity-100"
              title="Copy to clipboard"
            >
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}