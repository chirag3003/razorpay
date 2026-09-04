"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Assistant prose, rendered as markdown. The model emphasises with `**…**` and occasionally
 * reaches for a list; rendered as a raw string those land on screen as literal asterisks.
 *
 * **Do not add `rehype-raw`.** react-markdown ignores raw HTML in the source by default, and that
 * is the property that makes this safe to point at model output — which carries product names,
 * addresses and other tool data along with it. Enabling raw HTML reopens an injection path and
 * would then need `rehype-sanitize` to close again.
 *
 * Styling is per-element rather than via @tailwindcss/typography: the project doesn't have that
 * plugin, and prose inside a chat bubble wants tighter spacing than it would give anyway. The
 * width guards (`overflow-x-auto` on `pre` and `table`) matter because a bubble is capped at
 * `max-w-[80%]` — without them a code fence pushes the whole panel sideways.
 */
export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // `last:mb-0` keeps the bubble from gaining a trailing gap under the final paragraph.
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through">{children}</del>,

          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {children}
            </a>
          ),

          // Preflight strips list markers; put them back.
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,

          // A heading in a chat bubble shouldn't shout — all three land near body size.
          h1: ({ children }) => (
            <p className="mb-1 font-heading text-base font-semibold">{children}</p>
          ),
          h2: ({ children }) => (
            <p className="mb-1 font-heading text-sm font-semibold">{children}</p>
          ),
          h3: ({ children }) => (
            <p className="mb-1 font-heading text-sm font-medium">{children}</p>
          ),

          code: ({ className, children }) => {
            // react-markdown marks fenced code with a `language-*` class; inline code has none.
            const isBlock = /language-/.test(className ?? "");
            return (
              <code
                className={cn(
                  "rounded bg-foreground/10 font-mono text-[0.85em]",
                  isBlock ? "block p-0" : "px-1 py-0.5"
                )}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg bg-foreground/10 p-2 text-xs last:mb-0">
              {children}
            </pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-current/30 pl-3 italic last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-current/20" />,

          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-current/20 px-2 py-1 font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-current/20 px-2 py-1">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
