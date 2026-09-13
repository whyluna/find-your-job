import { afterEach, expect, it } from "vitest";
import { extractCompanyInPage } from "./extract";
import { newCompanyDraft, patchCompanyDraft } from "./company-draft";

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });
it("招聘门户可提取公司组织资料，但不会自动判定招聘已启动", () => {
  document.title = "校园招聘 - 示例科技";
  const script = document.createElement("script"); script.type = "application/ld+json";
  script.textContent = JSON.stringify({ "@type": "Organization", name: "示例科技", url: "https://example.com" }); document.head.append(script);
  const capture = extractCompanyInPage();
  expect(capture).toMatchObject({ companyName: "示例科技", website: "https://example.com", careersUrl: expect.any(String) });
  const draft = newCompanyDraft({ companyName: "", positionTitle: "", channel: "OTHER", source: "heuristic" }, capture);
  expect(draft.status).toBe("UNKNOWN");
  expect(draft.companyName).toBe("示例科技");
});
it("公司、届次、提醒字段转换正确，显式停用不会留下下一次提醒", () => {
  const initial = newCompanyDraft({ companyName: "公司", positionTitle: "", channel: "OTHER", source: "heuristic" });
  const linked = patchCompanyDraft(initial, { companyId: "existing", companyName: "旧公司" });
  expect(patchCompanyDraft(linked, { companyName: "新公司" }).companyId).toBeNull();
  expect(patchCompanyDraft(initial, { year: "2028", intervalDays: "", nextCheckAt: "" })).toMatchObject({ year: 2028, intervalDays: null, nextCheckAt: null });
});
