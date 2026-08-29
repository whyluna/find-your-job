/** PIN 锁：设置后启动需解锁（本地 sha256 比对，会话内存记录） */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui";

let unlockedSession = false;

export function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(unlockedSession);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const { data: has, isLoading } = useQuery({
    queryKey: ["has-pin"],
    queryFn: api.hasPin,
    staleTime: Infinity,
  });

  useEffect(() => {
    setUnlocked(unlockedSession);
  }, [has]);

  const unlock = async () => {
    setError("");
    const ok = await api.verifyPin(pin).catch(() => false);
    if (ok) {
      unlockedSession = true;
      setUnlocked(true);
    } else {
      setError("PIN 不正确");
    }
  };

  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  if (!has || unlocked) return <>{children}</>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white">
        <Lock className="size-5" />
      </div>
      <div className="text-sm font-medium">FindYourJob 已锁定</div>
      <input
        type="password"
        value={pin}
        autoFocus
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && unlock()}
        placeholder="输入 PIN"
        className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
      />
      {error && <div className="text-xs text-red-500">{error}</div>}
      <Button variant="primary" onClick={unlock} disabled={!pin}>
        解锁
      </Button>
    </div>
  );
}
