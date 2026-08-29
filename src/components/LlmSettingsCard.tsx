/** 智能识别（LLM）配置：供浏览器扩展调用，从网页原文抽取公司/岗位/城市并清洗 JD */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import { Button, TextInput } from "@/components/ui";

export function LlmSettingsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["llm-settings"], queryFn: api.llmGetSettings });

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data && !loaded) {
      setLoaded(true);
      setBaseUrl(data.baseUrl);
      setApiKey(data.apiKey);
      setModel(data.model);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      api.llmSaveSettings({
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
        model: model.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["llm-settings"] });
      setMsg({ kind: "ok", text: "已保存" });
    },
    onError: (e) => setMsg({ kind: "err", text: String(e) }),
  });

  const test = async () => {
    setMsg(null);
    setTesting(true);
    try {
      const r = await api.llmTest();
      setMsg({ kind: "ok", text: r });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const configured = !!apiKey.trim();

  return (
    <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4" /> 智能识别（LLM，可选）
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        配置后，浏览器扩展收录岗位时会把页面原文交给大模型，自动识别公司/岗位/城市，
        并把 JD 清洗成只含「职位描述 + 要求」的干净版本（不配置则用启发式提取，官网类页面效果差）。
        API Key 只保存在本机。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            API Base URL（OpenAI 兼容；智谱填 https://open.bigmodel.cn/api/paas/v4，DeepSeek 填 https://api.deepseek.com）
          </span>
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="font-mono text-xs"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">API Key</span>
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              className="font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">模型名</span>
            <TextInput
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="glm-4-flash / deepseek-chat / gpt-4o-mini"
              className="font-mono text-xs"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setMsg(null);
            save.mutate();
          }}
        >
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />}保存
        </Button>
        <Button size="sm" disabled={!configured || testing} onClick={test}>
          {testing && <Loader2 className="size-3.5 animate-spin" />}测试连接
        </Button>
        <span
          className={
            configured
              ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800"
          }
        >
          {configured ? "已配置" : "未配置"}
        </span>
        {msg && (
          <span className={msg.kind === "ok" ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-red-500"}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
