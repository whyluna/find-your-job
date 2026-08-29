import { NavLink } from "react-router";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Scale,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "投递", icon: BriefcaseBusiness, end: false },
  { to: "/stats", label: "统计", icon: BarChart3, end: false },
  { to: "/calendar", label: "日历", icon: CalendarDays, end: false },
  { to: "/review", label: "面经", icon: BookOpen, end: false },
  { to: "/offers", label: "offer 对比", icon: Scale, end: false },
  { to: "/resumes", label: "简历库", icon: FileText, end: false },
  { to: "/companies", label: "公司", icon: Building2, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-slate-200/70 bg-slate-100/70 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/50">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <div className="flex size-7 items-center justify-center rounded-[8px] bg-gradient-to-br from-indigo-500 to-cyan-400">
            <BriefcaseBusiness className="size-4 text-white" strokeWidth={2.2} />
          </div>
          <span className="text-[13px] font-semibold tracking-tight">FindYourJob</span>
        </div>
        <nav className="mt-1 flex flex-1 flex-col gap-0.5 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] transition-colors",
                  isActive
                    ? "bg-indigo-500/10 font-medium text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"
                    : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]",
                )
              }
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
