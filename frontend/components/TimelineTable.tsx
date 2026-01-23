"use client";

import { useMemo } from "react";

type TimelineItem = {
  Date: string;
  Event: string;
};

export default function TimelineTable({ content }: { content: string }) {
  const events = useMemo(() => {
    try {
      // Find JSON array in the content (it might have some wrapping text or newlines)
      const match = content.match(/\[\s*\{.*\}\s*\]/s);
      if (match) {
        return JSON.parse(match[0]) as TimelineItem[];
      }
      // Fallback: try parsing whole content if it's pure JSON
      return JSON.parse(content) as TimelineItem[];
    } catch (e) {
      return null;
    }
  }, [content]);

  if (!events || events.length === 0) return null;

  return (
    <div className="my-4 w-full overflow-hidden rounded-lg border border-border bg-surface/40 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/80 text-muted backdrop-blur-sm">
            <tr>
              <th className="border-b border-border px-4 py-3 font-semibold w-1/4">Date</th>
              <th className="border-b border-border px-4 py-3 font-semibold w-3/4">Event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((item, idx) => (
              <tr key={idx} className="group hover:bg-white/5 transition-colors">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary font-medium align-top">
                  {item.Date}
                </td>
                <td className="px-4 py-3 text-white/90 leading-relaxed align-top">
                  {item.Event}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}