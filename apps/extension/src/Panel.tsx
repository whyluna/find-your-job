import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { emptyState, stateKey, type Field, type PanelState } from "./drafts";

const CHANNELS = { COMPANY_SITE: "官网网申", BOSS: "Boss直聘", NOWCODER: "牛客", SHIXISENG: "实习僧", LIEPIN: "猎聘", REFERRAL: "内推", OTHER: "其他" };

export function Panel() {
  const [windowId, setWindowId] = useState<number>();
  const [state, setState] = useState<PanelState>(emptyState);
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const edits = useRef<Partial<Record<Field, { draftId: string; value: string; sequence: number }>>>({});
  const sequence = useRef(0);
  const polling = useRef(false);

  const accept = useCallback((incoming: PanelState) => {
    setState((current) => {
      if (incoming.revision < current.revision) return current;
      const next = structuredClone(incoming);
      for (const [field, pending] of Object.entries(edits.current)) {
        if (pending && next.draft?.id === pending.draftId) next.draft.clip[field as Field] = pending.value;
        else delete edits.current[field as Field];
      }
      return next;
    });
  }, []);

  const command = useCallback(async (type: string, args: Record<string, unknown> = {}) => {
    if (windowId === undefined) return;
    const reply = await browser.runtime.sendMessage({ scope: "fyj-panel", windowId, type, ...args });
    if (!reply?.ok) throw new Error(reply?.error ?? "插件后台未响应，请重新打开侧边栏");
    accept(reply.state);
    return reply.state as PanelState;
  }, [windowId, accept]);

  useEffect(() => {
    void browser.windows.getCurrent().then((window) => setWindowId(window.id));
    void browser.storage.local.get("token").then(({ token = "" }) => { setToken(String(token)); setSettings(!token); });
  }, []);

  useEffect(() => {
    if (windowId === undefined) return;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "session") return;
      const value = changes[stateKey(windowId)]?.newValue;
      if (value) accept(value as PanelState);
    };
    browser.storage.onChanged.addListener(changed);
    void command("state").catch((e) => setError(String(e)));
    return () => browser.storage.onChanged.removeListener(changed);
  }, [windowId, command, accept]);

  useEffect(() => {
    if (state.draft?.ai.status !== "running") return;
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try { await command("poll"); } catch (e) { setError(String(e)); }
      finally { polling.current = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [state.draft?.id, state.draft?.ai.status, command]);

  const act = async (type: string, args: Record<string, unknown> = {}) => {
    setError(""); setBusy(true);
    try { await command(type, { draftId: state.draft?.id, ...args }); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const edit = (field: Field, value: string) => {
    const draftId = state.draft?.id;
    if (!draftId) return;
    const id = ++sequence.current;
    edits.current[field] = { draftId, value, sequence: id };
    setState((s) => s.draft?.id === draftId ? { ...s, draft: { ...s.draft, clip: { ...s.draft.clip, [field]: value } } } : s);
    void command("edit", { draftId, field, value }).then((response) => {
      if (edits.current[field]?.sequence === id) delete edits.current[field];
      if (response) accept(response);
    }).catch((e) => setError(`草稿保存失败：${String(e)}`));
  };
  const draft = state.draft;
  const capture = () => {
    if (draft && !confirm("切换来源会清理当前未收录草稿，继续？")) return;
    void act("capture");
  };
  return <main>
    <header><span className="mark">↗</span><strong>FindYourJob</strong><button className="subtle" onClick={() => setSettings(!settings)}>设置</button></header>
    <div className="toolbar"><button onClick={capture} disabled={busy || windowId === undefined}>收录当前页面</button>
      {draft && <button className="subtle" disabled={busy} onClick={() => void act("discard")}>清空草稿</button>}
    </div>
    {settings && <section className="settings"><label>App 接入 Token<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="从 App 设置中复制" /></label>
      <button onClick={() => {
        void browser.storage.local.set({ token: token.trim() }).then(() => { setSettings(false); setError(""); }, (e) => setError(String(e)));
      }} disabled={!token.trim()}>保存 Token</button>
    </section>}
    {error && <p role="alert" className="message error">{error}</p>}
    {state.noticeKind === "error" && <p role="alert" className="message error">{state.notice}</p>}
    {state.noticeKind === "success" && <p role="status" className="message">{state.notice}</p>}
    {draft ? <>
      <section className="source"><small>正在编辑的来源页面</small><strong title={draft.source.title}>{draft.source.title || draft.clip.positionTitle}</strong>
        <span title={draft.source.url}>{draft.source.url}</span>
        <button className="subtle" onClick={() => { void browser.tabs.update(draft.source.tabId, { active: true }).catch((e) => setError(String(e))); }}>回到来源页面 ↗</button>
      </section>
      <button className="ai" disabled={busy || draft.submitting || draft.ai.status === "running"} onClick={() => void act("ai")}>
        {draft.ai.status === "running" ? "AI 解析中…" : "AI 解析岗位信息"}
      </button>
      {draft.ai.status === "failed" && <p role="alert" className="message error">{draft.ai.error}</p>}
      <fieldset disabled={!!draft.submitting}>
        <label>公司 *<input value={draft.clip.companyName} onChange={(e) => edit("companyName", e.target.value)} /></label>
        <label>岗位 *<input value={draft.clip.positionTitle} onChange={(e) => edit("positionTitle", e.target.value)} /></label>
        <div className="row"><label>部门<input value={draft.clip.department ?? ""} onChange={(e) => edit("department", e.target.value)} /></label>
          <label>城市<input value={draft.clip.workLocation ?? ""} onChange={(e) => edit("workLocation", e.target.value)} /></label></div>
        <label>渠道<select value={draft.clip.channel} onChange={(e) => edit("channel", e.target.value)}>{Object.entries(CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>岗位链接<input value={draft.clip.jobUrl ?? ""} onChange={(e) => edit("jobUrl", e.target.value)} /></label>
        <label>JD / 岗位要求<textarea value={draft.clip.jdText ?? ""} onChange={(e) => edit("jdText", e.target.value)} /></label>
      </fieldset>
      {draft.duplicate && <div className="message"><p>已存在：{draft.duplicate.companyName} · {draft.duplicate.positionTitle}</p>
        <button disabled={busy} onClick={() => void act("submit", { allowDuplicate: true })}>仍然新建一条</button></div>}
      <footer><button className="primary" disabled={busy || draft.submitting || !draft.clip.companyName.trim() || !draft.clip.positionTitle.trim()} onClick={() => void act("submit")}>
        {draft.submitting ? "添加中…" : "添加到意向岗位"}
      </button></footer>
    </> : <section className="empty"><p>在招聘网页点击“收录当前页面”，再使用 AI 解析或手动整理。</p></section>}
  </main>;
}
