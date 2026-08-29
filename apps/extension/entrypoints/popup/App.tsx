/** 弹窗：抓页面原文 → 本机 LLM 智能识别（失败回落启发式）→ 确认表单 → 收录 */
import { useEffect, useState } from "react";
import {
  extractJobInPage,
  extractPageContextInPage,
  channelFromUrl,
  type ExtractResult,
} from "../../src/extract";

const CHANNELS: [string, string][] = [
  ["COMPANY_SITE", "官网网申"],
  ["BOSS", "Boss直聘"],
  ["NOWCODER", "牛客"],
  ["SHIXISENG", "实习僧"],
  ["LIEPIN", "猎聘"],
  ["REFERRAL", "内推"],
  ["OTHER", "其他"],
];

const API = "http://127.0.0.1:37321";

type LlmState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "ok" }
  | { tag: "fail"; hint: string };

export default function App() {
  const [clip, setClip] = useState<ExtractResult | null>(null);
  const [llm, setLlm] = useState<LlmState>({ tag: "idle" });
  const [token, setToken] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { token = "" } = await browser.storage.local.get("token");
      setToken(token);
      setShowSettings(!token);
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // ① 本地启发式立即回填（快速反馈）
      const [heu] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractJobInPage,
      });
      const current = heu?.result as ExtractResult | undefined;
      if (current) {
        current.channel =
          current.channel === "OTHER" ? channelFromUrl(current.jobUrl ?? "") : current.channel;
        setClip(current);
      }

      // ② 智能识别：页面原文 → 本机应用 → LLM → 结构化回填
      if (!token.trim()) return;
      setLlm({ tag: "loading" });
      try {
        const [ctx] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageContextInPage,
        });
        const page = ctx?.result as { title: string; url: string; text: string } | undefined;
        if (!page) throw new Error("无法读取页面内容");
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90000);
        const r = await fetch(`${API}/api/ext/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
          body: JSON.stringify(page),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: String(r.status) }));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as {
          companyName: string;
          positionTitle: string;
          workLocation: string;
          jdText: string;
        };
        setClip((c) => ({
          companyName: j.companyName || c?.companyName || "",
          positionTitle: j.positionTitle || c?.positionTitle || "",
          department: c?.department,
          workLocation: j.workLocation || c?.workLocation || "",
          jobUrl: c?.jobUrl ?? page.url,
          jdText: j.jdText || c?.jdText || "",
          channel: c?.channel ?? channelFromUrl(page.url),
          source: "llm",
        }));
        setLlm({ tag: "ok" });
      } catch (e) {
        setLlm({ tag: "fail", hint: String((e as Error).message ?? e) });
      }
    })();
  }, []);

  async function saveToken() {
    await browser.storage.local.set({ token: token.trim() });
    setShowSettings(false);
  }

  async function submit() {
    if (!clip) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`${API}/api/ext/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({
          companyName: clip.companyName,
          positionTitle: clip.positionTitle,
          department: clip.department || null,
          workLocation: clip.workLocation || null,
          channel: clip.channel,
          jobUrl: clip.jobUrl || null,
          jdText: clip.jdText || null,
        }),
      });
      if (r.ok) {
        setMsg({ kind: "ok", text: "已收录到 FindYourJob（已保存状态）" });
      } else if (r.status === 401) {
        setMsg({ kind: "err", text: "Token 无效：请在应用设置页重置后更新" });
        setShowSettings(true);
      } else {
        setMsg({ kind: "err", text: `保存失败：${await r.text()}` });
      }
    } catch {
      setMsg({
        kind: "err",
        text: "连不上应用：请打开 FindYourJob 并在设置中开启「浏览器扩展接入」",
      });
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<ExtractResult>) => setClip((c) => (c ? { ...c, ...patch } : c));

  const sourceLabel =
    llm.tag === "loading"
      ? "智能识别中…（约几秒到十几秒）"
      : llm.tag === "ok"
        ? "智能识别（LLM）"
        : llm.tag === "fail"
          ? `启发式提取（智能识别未生效：${llm.hint.slice(0, 60)}）`
          : clip
            ? `启发式提取 · ${clip.source}`
            : "";

  return (
    <>
      <header>
        <span className="logo">F</span>
        收录岗位到 FindYourJob
      </header>
      <section>
        {showSettings ? (
          <>
            <label>应用设置页中的 API Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="在 FindYourJob 设置 → 浏览器扩展接入 复制"
            />
            <button className="primary" onClick={saveToken} disabled={!token.trim()}>
              保存 Token
            </button>
          </>
        ) : clip ? (
          <>
            <div className="row">
              <div>
                <label>公司 *</label>
                <input value={clip.companyName} onChange={(e) => set({ companyName: e.target.value })} />
              </div>
              <div>
                <label>岗位 *</label>
                <input value={clip.positionTitle} onChange={(e) => set({ positionTitle: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Base</label>
                <input value={clip.workLocation ?? ""} onChange={(e) => set({ workLocation: e.target.value })} />
              </div>
              <div>
                <label>渠道</label>
                <select value={clip.channel} onChange={(e) => set({ channel: e.target.value })}>
                  {CHANNELS.map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <label>JD 快照</label>
            <textarea value={clip.jdText ?? ""} onChange={(e) => set({ jdText: e.target.value })} />
            <div className="hint" style={{ marginTop: 4 }}>{sourceLabel}</div>
            <button
              className="primary"
              onClick={submit}
              disabled={saving || !clip.companyName.trim() || !clip.positionTitle.trim()}
            >
              {saving ? "保存中…" : "确认收录"}
            </button>
          </>
        ) : (
          <div className="hint">正在读取当前页面…</div>
        )}

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {!showSettings && (
          <div className="settings-toggle" onClick={() => setShowSettings(true)}>
            修改 Token
          </div>
        )}
      </section>
    </>
  );
}
