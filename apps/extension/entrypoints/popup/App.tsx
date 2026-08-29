/** 弹窗：提取当前页岗位 → 可编辑确认表单 → POST 到本地 FindYourJob */
import { useEffect, useState } from "react";
import { extractJobInPage, type ExtractResult } from "../../src/extract";

const CHANNELS: [string, string][] = [
  ["COMPANY_SITE", "官网网申"],
  ["BOSS", "Boss直聘"],
  ["NOWCODER", "牛客"],
  ["SHIXISENG", "实习僧"],
  ["LIEPIN", "猎聘"],
  ["REFERRAL", "内推"],
  ["OTHER", "其他"],
];

export default function App() {
  const [clip, setClip] = useState<ExtractResult | null>(null);
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
      const [res] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractJobInPage,
      });
      if (res?.result) setClip(res.result as ExtractResult);
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
      const r = await fetch("http://127.0.0.1:37321/api/ext/clip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
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
            <div className="hint" style={{ marginTop: 4 }}>提取层：{clip.source}</div>
            <button className="primary" onClick={submit} disabled={saving || !clip.companyName.trim() || !clip.positionTitle.trim()}>
              {saving ? "保存中…" : "确认收录"}
            </button>
          </>
        ) : (
          <div className="hint">正在提取当前页面…</div>
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
