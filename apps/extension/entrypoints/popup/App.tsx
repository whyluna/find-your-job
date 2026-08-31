/** 弹窗：启发式即时回填 → 手动点「AI 识别」用 LLM 精修（公司/岗位/Base + JD 清洗）→ 确认收录 */
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

type AiState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "ok" }
  | { tag: "fail"; hint: string };

export default function App() {
  const [clip, setClip] = useState<ExtractResult | null>(null);
  const [ai, setAi] = useState<AiState>({ tag: "idle" });
  const [token, setToken] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; companyName: string; positionTitle: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { token = "" } = await browser.storage.local.get("token");
        setToken(token);
        setShowSettings(!token);
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("找不到当前标签页");
        // 打开时只跑本地启发式（毫秒级），LLM 由按钮手动触发
        const [heu] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractJobInPage,
        });
        const current = heu?.result as ExtractResult | undefined;
        if (!current) throw new Error("当前页面无法读取，请在普通招聘网页中重试");
        current.channel =
          current.channel === "OTHER" ? channelFromUrl(current.jobUrl ?? "") : current.channel;
        setClip(current);
      } catch (error) {
        setMsg({ kind: "err", text: String((error as Error).message ?? error) });
      }
    })();
  }, []);

  async function runAi() {
    setAi({ tag: "loading" });
    setMsg(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("找不到当前标签页");
      const [ctx] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContextInPage,
      });
      const page = ctx?.result as { title: string; url: string; text: string } | undefined;
      if (!page) throw new Error("无法读取页面内容");
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 90000);
      const r = await fetch(`${API}/api/ext/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify(page),
        signal: ctrl.signal,
      });
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
      setSaved(false);
      setDuplicate(null);
      setAi({ tag: "ok" });
    } catch (e) {
      setAi({ tag: "fail", hint: String((e as Error).message ?? e) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function saveToken() {
    await browser.storage.local.set({ token: token.trim() });
    setShowSettings(false);
  }

  async function submit(allowDuplicate = false) {
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
          allowDuplicate,
        }),
      });
      if (r.ok) {
        const body = (await r.json()) as {
          created: boolean;
          application: { id: string; companyName: string; positionTitle: string };
        };
        if (body.created) {
          setSaved(true);
          setDuplicate(null);
          setMsg({ kind: "ok", text: "已收录到 FindYourJob（已保存状态）" });
        } else {
          setDuplicate(body.application);
          setMsg({ kind: "ok", text: "这个岗位已经收录过，没有重复创建" });
        }
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

  const set = (patch: Partial<ExtractResult>) => {
    setSaved(false);
    setDuplicate(null);
    setMsg(null);
    setClip((c) => (c ? { ...c, ...patch } : c));
  };

  const sourceLabel =
    ai.tag === "loading"
      ? "AI 识别中…"
      : ai.tag === "ok"
        ? "✨ AI 识别结果（可修改）"
        : ai.tag === "fail"
          ? `启发式结果 · AI 识别失败：${ai.hint.slice(0, 50)}`
          : clip
            ? `启发式结果 · ${clip.source}`
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
              type="password"
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
            <button
              id="aiBtn"
              onClick={runAi}
              disabled={ai.tag === "loading"}
              style={{
                width: "100%",
                padding: "7px",
                marginBottom: "8px",
                background: "linear-gradient(135deg,#6366f1,#06b6d4)",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: ai.tag === "loading" ? "default" : "pointer",
                opacity: ai.tag === "loading" ? 0.7 : 1,
              }}
            >
              {ai.tag === "loading" ? "✨ AI 识别中…（数秒）" : "✨ AI 识别（公司/岗位/JD 清洗）"}
            </button>
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
              onClick={() => submit(false)}
              disabled={saved || saving || !clip.companyName.trim() || !clip.positionTitle.trim()}
            >
              {saving ? "保存中…" : saved ? "已收录" : "确认收录"}
            </button>
            {duplicate && (
              <div className="duplicate-box">
                <div>现有记录：{duplicate.companyName} · {duplicate.positionTitle}</div>
                <button onClick={() => submit(true)} disabled={saving}>仍然新建一条</button>
              </div>
            )}
          </>
        ) : (
          <div className="hint">正在读取当前页面…</div>
        )}

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {!showSettings && (
          <button type="button" className="settings-toggle" onClick={() => setShowSettings(true)}>
            修改 Token
          </button>
        )}
      </section>
    </>
  );
}
