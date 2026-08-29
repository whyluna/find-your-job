/** 首次启动场景模板向导（设计 §3.6）：选校招/社招/实习/空白 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Briefcase, Coffee, Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { SCENARIO_TEMPLATES, type ScenarioTemplate } from "@shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

const TEMPLATE_ICONS: Record<string, typeof GraduationCap> = {
  campus: GraduationCap,
  social: Briefcase,
  intern: Coffee,
  blank: Sparkles,
};

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["onboarded"],
    queryFn: () => api.getSetting("onboarded"),
  });

  const finish = useMutation({
    mutationFn: async (template: ScenarioTemplate) => {
      await api.setSetting("scenario_template", JSON.stringify(template.key));
      await api.setSetting(
        "board_columns",
        JSON.stringify(template.boardStatuses),
      );
      await api.setSetting("onboarded", "true");
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (data === "true") return <>{children}</>;

  const selected = SCENARIO_TEMPLATES.find((t) => t.key === picked);

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-10 dark:from-slate-950 dark:to-slate-900">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-lg font-bold text-white">
          F
        </div>
        <div>
          <div className="text-lg font-semibold">欢迎使用 FindYourJob</div>
          <div className="text-xs text-slate-500">
            先选一个场景模板，决定看板列与事件菜单（之后随时可改）
          </div>
        </div>
      </div>

      <div className="mt-6 grid w-full max-w-3xl grid-cols-2 gap-3">
        {SCENARIO_TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICONS[t.key] ?? Sparkles;
          return (
            <button
              key={t.key}
              onClick={() => setPicked(t.key)}
              className={cn(
                "rounded-xl border-2 p-4 text-left transition-all",
                picked === t.key
                  ? "border-indigo-500 bg-indigo-50/50 dark:border-indigo-400 dark:bg-indigo-900/20"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4.5 text-indigo-500" />
                <span className="text-sm font-semibold">{t.name}</span>
              </div>
              <div className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t.description}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" disabled={!picked || finish.isPending} onClick={() => picked && finish.mutate(selected!)}>
          {finish.isPending && <Loader2 className="size-4 animate-spin" />}
          开始使用
        </Button>
        <Button variant="ghost" disabled={finish.isPending} onClick={() => finish.mutate(SCENARIO_TEMPLATES[3])}>
          跳过（用空白模板）
        </Button>
      </div>
      {finish.isError && (
        <div className="mt-3 text-xs text-red-500">初始化失败：{String(finish.error)}</div>
      )}
    </div>
  );
}
