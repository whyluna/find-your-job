/** 基础 UI 原语：按钮/输入/选择/弹窗/状态徽章（shadcn 风格的轻量手写版） */
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "default" &&
          "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
        variant === "primary" &&
          "bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400",
        variant === "ghost" &&
          "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
        variant === "danger" &&
          "bg-red-600 text-white hover:bg-red-500",
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
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/50",
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
        "w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/50",
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
      <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{hint}</div>}
    </label>
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[85vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
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
        "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? STATUS_STYLES.SAVED,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
