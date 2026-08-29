/**
 * LaTeX 公式渲染文本：支持 $...$ 行内公式与 $$...$$ 块级公式，其余按普通文本输出。
 * 用于面经题目/回答/复盘等大模型相关内容。公式语法错误时红字提示原文，不炸页面。
 */
import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

function renderSegment(seg: string, display: boolean, key: number): React.ReactNode {
  try {
    const html = katex.renderToString(seg, {
      displayMode: display,
      throwOnError: true,
      strict: false,
      trust: false,
    });
    return display ? (
      <div key={key} className="my-2 overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <span key={key} dangerouslySetInnerHTML={{ __html: html }} />
    );
  } catch {
    return (
      <span key={key} className="rounded bg-red-50 px-1 font-mono text-[0.9em] text-red-500 dark:bg-red-900/20">
        {display ? `$$${seg}$$` : `$${seg}$`}
      </span>
    );
  }
}

export function LatexText({ children, className }: { children: string; className?: string }) {
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    // 先按 $$...$$ 分块，块内再按 $...$ 分行内
    const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(children)) !== null) {
      if (m.index > last) out.push(children.slice(last, m.index));
      if (m[1] !== undefined) {
        out.push(renderSegment(m[1], true, k++));
      } else if (m[2] !== undefined) {
        out.push(renderSegment(m[2], false, k++));
      }
      last = m.index + m[0].length;
    }
    if (last < children.length) out.push(children.slice(last));
    return out;
  }, [children]);

  return <span className={cn("leading-relaxed", className)}>{parts}</span>;
}
