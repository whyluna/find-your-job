import { NavLink } from "react-router";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  FileText,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "投递", icon: BriefcaseBusiness, end: false },
  { to: "/stats", label: "统计", icon: BarChart3, end: false },
  { to: "/resumes", label: "简历库", icon: FileText, end: false },
  { to: "/companies", label: "公司", icon: Building2, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 dark:border-slate-800 dark:bg-black">
        <div className="flex items-center gap-2.5 px-5 pb-2 pt-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400">
            <BriefcaseBusiness className="size-4.5 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">FindYourJob</div>
            <div className="text-[11px] text-slate-400">求职投递记录</div>
          </div>
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white/12 font-medium text-white"
                    : "text-slate-300 hover:bg-white/6 hover:text-white",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 pb-4 text-[11px] text-slate-500">
          本地数据 · v0.1.0
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
