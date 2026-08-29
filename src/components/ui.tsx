/** 设计系统原语：macOS 风格的按钮/输入/分段控件/页头/弹窗/徽章 */
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type Status } from "@shared";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium transition-[background,border-color,box-shadow,transform] duration-100 active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-[30px] px-3 text-[13px]",
        variant === "default" &&
          "border border-[var(--fyj-border)] bg-[var(--fyj-surface-solid)] text-[var(--fyj-text)] shadow-[var(--fyj-control-shadow)] hover:bg-[var(--fyj-surface-muted)]",
        variant === "primary" &&
          "border border-black/5 bg-[var(--fyj-accent)] text-white shadow-[0_1px_1px_rgba(0,55,120,0.18)] hover:bg-[var(--fyj-accent-hover)]",
        variant === "ghost" &&
          "text-[var(--fyj-secondary)] hover:bg-black/[0.045] hover:text-[var(--fyj-text)] dark:hover:bg-white/[0.07]",
        variant === "danger" && "border border-red-700/10 bg-[#e5484d] text-white hover:bg-[#d93d42]",
        className,
      )}
      {...props}
    />
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-[30px] w-full rounded-[7px] border border-[var(--fyj-border)] bg-[var(--fyj-surface-solid)] px-2.5 text-[13px] text-[var(--fyj-text)] shadow-[inset_0_1px_1px_rgba(0,0,0,0.025)] placeholder:text-[var(--fyj-tertiary)] focus:border-[var(--fyj-accent)] focus:outline-none focus:ring-[3px] focus:ring-blue-500/10",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-[30px] w-full appearance-none rounded-[7px] border border-[var(--fyj-border)] bg-[var(--fyj-surface-solid)] px-2.5 text-[13px] text-[var(--fyj-text)] shadow-[var(--fyj-control-shadow)] focus:border-[var(--fyj-accent)] focus:outline-none focus:ring-[3px] focus:ring-blue-500/10",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium text-[var(--fyj-secondary)]">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">{hint}</div>}
    </label>
  );
}

/** macOS 风格分段控件 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex items-center rounded-[8px] border border-[var(--fyj-border)] bg-[var(--fyj-surface-muted)] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-[25px] items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium transition-all",
            value === o.value
              ? "bg-[var(--fyj-surface-solid)] text-[var(--fyj-text)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
              : "text-[var(--fyj-secondary)] hover:text-[var(--fyj-text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 统一页头：标题 + 副标题 + 右侧操作 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="toolbar-sticky page-header">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--fyj-text)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-[var(--fyj-secondary)]">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[3px]" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[85vh] w-full overflow-y-auto rounded-[12px] bg-[var(--fyj-surface-solid)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.08)]",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--fyj-tertiary)] hover:bg-black/[0.05] hover:text-[var(--fyj-text)] dark:hover:bg-white/[0.08]"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<Status, { badge: string; dot: string }> = {
  SAVED: { badge: "text-slate-600 dark:text-slate-300", dot: "bg-slate-400" },
  APPLIED: { badge: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  ASSESSMENT: { badge: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  WRITTEN: { badge: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  INTERVIEWING: { badge: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  OC: { badge: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  INTENT: { badge: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  OFFER: { badge: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  SIGNED: { badge: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  REJECTED: { badge: "text-red-700 dark:text-red-300", dot: "bg-red-500" },
  WITHDRAWN: { badge: "text-slate-400 dark:text-slate-500", dot: "bg-slate-400" },
};

export function StatusBadge({ status }: { status: Status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.SAVED;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-black/[0.035] px-2 py-0.5 text-[11px] font-medium dark:bg-white/[0.065]",
        style.badge,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
