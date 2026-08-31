/** ⌘K 命令面板：快捷命令 + 投递搜索跳转 */
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { STATUS_LABELS, type Status } from "@shared";
import { cn } from "@/lib/utils";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onCreateApplication,
}: {
  open: boolean;
  onClose: () => void;
  onCreateApplication: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const listId = useId();
  closeRef.current = onClose;

  const { data: results } = useQuery({
    queryKey: ["palette-search", query],
    queryFn: () => api.listApplications({ search: query.trim() || null }),
    enabled: open && query.trim().length > 0,
  });

  const items = useMemo<PaletteItem[]>(() => {
    const commands: PaletteItem[] = [
      { id: "cmd-create", label: "新建投递", hint: "命令", run: onCreateApplication },
      { id: "cmd-board", label: "去投递看板", hint: "导航", run: () => navigate("/applications") },
      { id: "cmd-stats", label: "去统计", hint: "导航", run: () => navigate("/stats") },
      { id: "cmd-cal", label: "去日历", hint: "导航", run: () => navigate("/calendar") },
      { id: "cmd-resumes", label: "去简历库", hint: "导航", run: () => navigate("/resumes") },
      { id: "cmd-settings", label: "去设置", hint: "导航", run: () => navigate("/settings") },
    ];
    const apps: PaletteItem[] = (results ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      label: `${a.companyName} · ${a.positionTitle}`,
      hint: STATUS_LABELS[a.status as Status] ?? "",
      run: () => navigate(`/applications/${a.id}`),
    }));
    return [...apps, ...commands];
  }, [results, navigate, onCreateApplication]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const root = document.getElementById("root");
      root?.setAttribute("inert", "");
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      const trap = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeRef.current();
          return;
        }
        if (event.key !== "Tab" || !panelRef.current) return;
        const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
        )];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      window.addEventListener("keydown", trap);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", trap);
        root?.removeAttribute("inert");
        previous?.focus();
      };
    }
  }, [open]);

  if (!open) return null;

  const runItem = (i: number) => {
    items[i]?.run();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="快速搜索与命令"
        className="relative w-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 dark:border-slate-800">
          <Search className="size-4 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runItem(active);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="搜索投递或执行命令…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${items[active].id}` : undefined}
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700">esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => runItem(i)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                i === active
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800/60",
              )}
            >
              <span className="truncate">{item.label}</span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {item.hint}
                {i === active && <CornerDownLeft className="size-3" />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
