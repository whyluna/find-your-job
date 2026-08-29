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
    group: "",
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
    <div className="app-shell flex h-full">
      <aside className="app-sidebar relative flex w-[224px] shrink-0 flex-col border-r backdrop-blur-2xl">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-9" />
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-[36px]">
          <AppMark />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--fyj-text)]">
            FindYourJob
          </span>
        </div>
        <nav className="mt-1 flex flex-1 flex-col px-2.5">
          {NAV_GROUPS.map((g) => (
            <div key={g.group || "primary"} className="mb-3.5">
              {g.group && (
                <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.035em] text-[var(--fyj-tertiary)]">
                  {g.group}
                </div>
              )}
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      "mb-px flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[14px] transition-[background,color] duration-100",
                      isActive
                        ? "bg-[var(--fyj-accent-soft)] font-medium text-[var(--fyj-accent)]"
                        : "text-[var(--fyj-secondary)] hover:bg-black/[0.045] hover:text-[var(--fyj-text)] dark:hover:bg-white/[0.065]",
                    )
                  }
                >
                  <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="app-main min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function AppMark() {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[#176fd3] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,62,132,0.2)]">
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
        <path d="M4.3 8.5 20 3.8l-7.7 15.1-2.1-6.4L4.3 8.5Z" fill="#fff" />
        <path d="m10.2 12.5 2.1 6.4 2-7.1L20 3.8l-9.8 8.7Z" fill="#d9ebff" />
      </svg>
    </div>
  );
}
