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

const NAV_GROUPS: {
  group: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }[];
}[] = [
  {
    group: "跟踪",
    items: [
      { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
      { to: "/applications", label: "投递", icon: BriefcaseBusiness },
      { to: "/stats", label: "统计", icon: BarChart3 },
      { to: "/calendar", label: "日历", icon: CalendarDays },
    ],
  },
  {
    group: "沉淀",
    items: [
      { to: "/review", label: "面经", icon: BookOpen },
      { to: "/offers", label: "offer 对比", icon: Scale },
    ],
  },
  {
    group: "资料",
    items: [
      { to: "/resumes", label: "简历库", icon: FileText },
      { to: "/companies", label: "公司", icon: Building2 },
    ],
  },
  {
    group: "系统",
    items: [{ to: "/settings", label: "设置", icon: Settings }],
  },
];

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-slate-200/70 bg-slate-100/70 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/50">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <div className="flex size-8 items-center justify-center rounded-[9px] bg-gradient-to-br from-indigo-500 to-cyan-400">
            <BriefcaseBusiness className="size-[18px] text-white" strokeWidth={2.2} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">FindYourJob</span>
        </div>
        <nav className="mt-2 flex flex-1 flex-col px-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
                {g.group}
              </div>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      "mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-indigo-500/10 font-medium text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"
                        : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]",
                    )
                  }
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
