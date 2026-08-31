import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { onToast, type ToastRequest } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface ToastItem extends ToastRequest {
  id: number;
}

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 1;
    return onToast((request) => {
      const item: ToastItem = { ...request, id: nextId++ };
      setItems((current) => [...current.slice(-3), item]);
      window.setTimeout(
        () => setItems((current) => current.filter((candidate) => candidate.id !== item.id)),
        request.durationMs ?? (request.action ? 8000 : 4500),
      );
    });
  }, []);

  const dismiss = (id: number) => setItems((current) => current.filter((item) => item.id !== id));

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[360px] max-w-[calc(100vw-40px)] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => {
        const kind = item.kind ?? "info";
        const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : Info;
        return (
          <div
            key={item.id}
            role={kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-[var(--fyj-border)] bg-[var(--fyj-surface-solid)] px-3.5 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.18)]"
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                kind === "success" ? "text-emerald-500" : kind === "error" ? "text-red-500" : "text-[var(--fyj-accent)]",
              )}
            />
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--fyj-text)]">{item.message}</div>
            {item.action && item.actionLabel && (
              <button
                className="shrink-0 text-[13px] font-medium text-[var(--fyj-accent)] hover:underline"
                onClick={async () => {
                  dismiss(item.id);
                  await item.action?.();
                }}
              >
                {item.actionLabel}
              </button>
            )}
            <button
              aria-label="关闭提示"
              className="shrink-0 rounded p-0.5 text-[var(--fyj-tertiary)] hover:bg-[var(--fyj-surface-muted)]"
              onClick={() => dismiss(item.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
