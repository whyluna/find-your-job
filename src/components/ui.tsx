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
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
        variant === "default" &&
          "border border-slate-200/90 bg-white text-slate-700 shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80",
        variant === "primary" &&
          "bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400",
        variant === "ghost" &&
          "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
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
        "h-8 w-full rounded-md border border-slate-200/90 bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-400/10",
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
        "h-8 w-full appearance-none rounded-md border border-slate-200/90 bg-white px-2.5 text-[13px] text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
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
      <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-amber-600/90 dark:text-amber-400">{hint}</div>}
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
    <div className="inline-flex items-center rounded-[8px] bg-slate-100 p-[2px] dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-all",
            value === o.value
              ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-slate-600 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
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
    <div className="toolbar-sticky">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</p>
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
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[85vh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-2xl ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<Status, string> = {
  SAVED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  APPLIED: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  ASSESSMENT: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  WRITTEN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  INTERVIEWING: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  OC: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  INTENT: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  OFFER: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  SIGNED: "bg-emerald-600 text-white",
  REJECTED: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  WITHDRAWN: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status] ?? STATUS_STYLES.SAVED,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
