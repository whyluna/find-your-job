import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { api } from "@/lib/ipc";
import { refreshNotifierSchedule, setNotificationsEnabled } from "@/lib/notifier";
import { showToast } from "@/lib/toast";
import { Select } from "@/components/ui";

export function NotificationSettingsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const [enabled, deadlineHours, interviewHours] = await Promise.all([
        api.getSetting("notifications_enabled"),
        api.getSetting("deadline_reminder_hours"),
        api.getSetting("interview_reminder_hours"),
      ]);
      return {
        enabled: enabled === "true",
        deadlineHours: deadlineHours ?? "24",
        interviewHours: interviewHours ?? "2",
      };
    },
  });

  const toggle = useMutation({
    mutationFn: setNotificationsEnabled,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
      showToast({ kind: "success", message: data?.enabled ? "系统提醒已关闭" : "系统提醒已开启" });
    },
  });

  const saveHours = async (key: string, value: string) => {
    try {
      await api.setSetting(key, value);
      await queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
      await refreshNotifierSchedule();
      showToast({ kind: "success", message: "提醒时间已更新" });
    } catch (reason) {
      showToast({ kind: "error", message: String(reason) });
    }
  };

  return (
    <section className="mt-4 max-w-2xl rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Bell className="size-4" /> 系统提醒
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
        在截止日期和面试临近时发送 macOS 通知。只有你在这里主动开启时才会申请系统权限；当前版本需保持
        FindYourJob 运行，完全退出应用后不会发送提醒。
      </p>
      <div className="mt-4 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--fyj-accent)]"
            checked={data?.enabled ?? false}
            disabled={!data || toggle.isPending}
            onChange={(event) => toggle.mutate(event.target.checked)}
          />
          {toggle.isPending && <Loader2 className="size-3.5 animate-spin" />}
          {data?.enabled ? "提醒已开启" : "提醒已关闭"}
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[12px] text-[var(--fyj-secondary)]">
          截止日期提前
          <Select
            className="mt-1"
            value={data?.deadlineHours ?? "24"}
            disabled={!data?.enabled}
            onChange={(event) => void saveHours("deadline_reminder_hours", event.target.value)}
          >
            <option value="24">24 小时</option>
            <option value="48">48 小时</option>
            <option value="72">72 小时</option>
          </Select>
        </label>
        <label className="text-[12px] text-[var(--fyj-secondary)]">
          面试提前
          <Select
            className="mt-1"
            value={data?.interviewHours ?? "2"}
            disabled={!data?.enabled}
            onChange={(event) => void saveHours("interview_reminder_hours", event.target.value)}
          >
            <option value="2">2 小时</option>
            <option value="12">12 小时</option>
            <option value="24">24 小时</option>
          </Select>
        </label>
      </div>
    </section>
  );
}
