import type { ReactNode } from 'react';

/** Minimal, safe markdown → React (headings, lists, bold, italics, inline code, code blocks). No HTML injection. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  const flush = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      out.push(list.ordered ? <ol key={out.length} className="my-1.5 list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={out.length} className="my-1.5 list-disc space-y-0.5 pl-5">{items}</ul>);
      list = null;
    }
  };
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        out.push(<pre key={out.length} className="scroll-thin my-2 overflow-x-auto rounded-[5px] border border-line bg-paper-2 p-2.5 font-mono text-[11.5px]">{code.join('\n')}</pre>);
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1]!.length;
      out.push(<div key={out.length} className={level === 1 ? 'mt-1 mb-2 text-[16px] font-semibold' : level === 2 ? 'mt-3 mb-1 font-mono text-[11px] tracking-[0.12em] text-ink-3 uppercase' : 'mt-2 mb-1 font-semibold'}>{inline(h[2]!)}</div>);
    } else if (ol || ul) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ol ?? ul)![1]!);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      out.push(<p key={out.length} className="my-1.5">{inline(line)}</p>);
    }
  }
  flush();
  return <div className="text-[13px] leading-relaxed text-ink" data-selectable>{out}</div>;
}

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={m.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) parts.push(<code key={m.index} className="rounded-[3px] bg-paper-2 px-1 font-mono text-[11.5px]">{t.slice(1, -1)}</code>);
    else parts.push(<em key={m.index}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
