import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Database, Loader2 } from "lucide-react";

interface DbReadyInfo {
  ok: boolean;
  db_path: string;
  companies: number;
  applications: number;
  events: number;
}

/** P0-1 脚手架健康检查：IPC → Rust → SQLite 迁移全链路 */
export function DbHealthCard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["db-ready"],
    queryFn: () => invoke<DbReadyInfo>("db_ready"),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <Database className="size-4" />
        数据库健康检查
      </div>
      {isLoading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> 连接中…
        </div>
      )}
      {isError && (
        <div className="mt-3 text-sm text-red-500">
          连接失败：{String(error)}
        </div>
      )}
      {data && (
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={
                data.ok
                  ? "rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
              }
            >
              {data.ok ? "正常" : "异常"}
            </span>
            <span className="text-slate-500">表结构已初始化</span>
          </div>
          <div className="font-mono text-xs text-slate-400">{data.db_path}</div>
          <div className="text-slate-500">
            公司 {data.companies} · 投递 {data.applications} · 事件 {data.events}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">仪表盘</h1>
      <p className="mt-1 text-sm text-slate-500">
        今日截止与未来面试将在 P1 完善；当前为脚手架阶段。
      </p>
      <div className="mt-6 max-w-xl">
        <DbHealthCard />
      </div>
    </div>
  );
}
