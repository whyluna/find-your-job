/**
 * 静默初始化：统一使用校招模板（不再显示选择向导）。
 * 首次启动时自动写入默认配置；已有配置时不做任何事。
 */
import { useEffect } from "react";
import { api } from "@/lib/ipc";
import { SCENARIO_TEMPLATES } from "@shared";

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    (async () => {
      try {
        const onboarded = await api.getSetting("onboarded");
        if (onboarded === "true") return;
        const campus = SCENARIO_TEMPLATES.find((t) => t.key === "campus")!;
        await api.setSetting("scenario_template", JSON.stringify(campus.key));
        await api.setSetting("board_columns", JSON.stringify(campus.boardStatuses));
        await api.setSetting("onboarded", "true");
      } catch {
        // 初始化失败不阻塞使用（下次启动重试）
      }
    })();
  }, []);

  return <>{children}</>;
}
