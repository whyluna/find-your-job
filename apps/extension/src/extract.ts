/**
 * 岗位提取器：通过 chrome.scripting.executeScript 动态注入（非常驻 content script）。
 * 三层策略：站点适配器 → 通用 JobPosting JSON-LD → 启发式兜底。仅手动触发时执行。
 */

export interface ExtractResult {
  companyName: string;
  positionTitle: string;
  department?: string;
  workLocation?: string;
  jobUrl?: string;
  jdText?: string;
  channel: string;
  source: string; // 命中的提取层
}

/** 在页面上下文中执行（会被序列化，不能引用外部作用域） */
export function extractJobInPage(): ExtractResult {
  const result: ExtractResult = {
    companyName: "",
    positionTitle: "",
    jobUrl: location.href,
    jdText: "",
    channel: "OTHER",
    source: "heuristic",
  };

  const host = location.hostname;

  // ① 站点适配器
  if (host.includes("zhipin.com")) {
    result.channel = "BOSS";
    const name =
      document.querySelector(".job-salary")?.parentElement?.textContent ?? "";
    const title =
      document.querySelector(".job-banner .name")?.textContent ??
      document.querySelector("h1")?.textContent ??
      "";
    const company =
      document.querySelector(".company-info .company")?.textContent ??
      document.querySelector("[ka='job-detail-company']")?.textContent ??
      "";
    const desc =
      document.querySelector(".job-sec-text")?.textContent ??
      document.querySelector(".job-detail-section")?.textContent ??
      "";
    if (title || company) {
      result.source = "zhipin";
      result.positionTitle = title.trim().split("\n")[0];
      result.companyName = company.trim();
      result.jdText = desc.trim().slice(0, 4000);
    }
  } else if (host.includes("nowcoder.com")) {
    result.channel = "NOWCODER";
    const title = document.querySelector(".job-header-content .job-name")?.textContent ??
      document.querySelector("h1")?.textContent ?? "";
    const company = document.querySelector(".job-header-content .company-name")?.textContent ?? "";
    if (title) {
      result.source = "nowcoder";
      result.positionTitle = title.trim();
      result.companyName = company.trim();
      result.jdText = document.body.innerText.slice(0, 4000);
    }
  } else if (host.includes("liepin.com")) {
    result.channel = "LIEPIN";
    const title = document.querySelector(".job-apply-container .job-title")?.textContent ??
      document.querySelector("h1")?.textContent ?? "";
    const company = document.querySelector(".company-name")?.textContent ?? "";
    if (title) {
      result.source = "liepin";
      result.positionTitle = title.trim();
      result.companyName = company.trim();
      result.jdText = document.body.innerText.slice(0, 4000);
    }
  } else if (host.includes("shixiseng.com")) {
    result.channel = "SHIXISENG";
    const title = document.querySelector(".job-title")?.textContent ??
      document.querySelector("h1")?.textContent ?? "";
    const company = document.querySelector(".company")?.textContent ?? "";
    if (title) {
      result.source = "shixiseng";
      result.positionTitle = title.trim();
      result.companyName = company.trim();
      result.jdText = document.body.innerText.slice(0, 4000);
    }
  }

  // ② 通用 JobPosting JSON-LD（公司官网网申页大多有）
  if (!result.companyName || !result.jdText) {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent ?? "");
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if ((item["@type"] ?? "").includes("JobPosting")) {
            result.source = "jsonld";
            result.positionTitle = result.positionTitle || (item.title ?? "");
            result.companyName =
              result.companyName ||
              (typeof item.hiringOrganization === "object"
                ? (item.hiringOrganization?.name ?? "")
                : (item.hiringOrganization ?? ""));
            const loc = item.jobLocation?.address?.addressLocality;
            result.workLocation = result.workLocation || loc || "";
            result.jdText =
              result.jdText ||
              (typeof item.description === "string"
                ? item.description.replace(/<[^>]+>/g, " ").slice(0, 4000)
                : "");
            result.jobUrl = result.jobUrl || (item.url ?? location.href);
            break;
          }
        }
      } catch {
        /* 非法 JSON 忽略 */
      }
    }
  }

  // ③ 兜底启发式
  if (!result.positionTitle) {
    result.positionTitle =
      document.querySelector("h1")?.textContent?.trim().slice(0, 120) ||
      document.title.slice(0, 120);
    result.jdText = result.jdText || document.body.innerText.slice(0, 3000);
  }

  return result;
}

/** 从 URL 推断渠道（当提取器未给出时） */
export function channelFromUrl(url: string): string {
  if (url.includes("zhipin.com")) return "BOSS";
  if (url.includes("nowcoder.com")) return "NOWCODER";
  if (url.includes("liepin.com")) return "LIEPIN";
  if (url.includes("shixiseng.com")) return "SHIXISENG";
  return "COMPANY_SITE";
}
