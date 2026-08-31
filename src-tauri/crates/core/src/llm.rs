//! LLM 智能抽取（可选增强）：调用 OpenAI 兼容接口（chat/completions），
//! 从招聘网页原文中抽取结构化信息并清洗 JD。API Key 存在系统凭据库，
//! 不进入 SQLite，也不会进入数据备份。

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::services::Services;

const KEYRING_SERVICE: &str = "com.findyourjob.llm";
const KEYRING_ACCOUNT: &str = "api-key";

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl LlmConfig {
    pub fn is_configured(&self) -> bool {
        !self.api_key.is_empty()
    }
}

fn keyring_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| Error::Msg(format!("无法访问系统凭据库: {e}")))
}

/// 从系统凭据库读取 API Key。凭据库不可用或未配置时返回 None。
pub fn read_api_key() -> Option<String> {
    keyring_entry()
        .ok()?
        .get_password()
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 保存或删除系统凭据库中的 API Key。
pub fn save_api_key(value: &str) -> Result<()> {
    let entry = keyring_entry()?;
    let value = value.trim();
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Msg(format!("删除系统凭据失败: {e}"))),
        }
    } else {
        entry
            .set_password(value)
            .map_err(|e| Error::Msg(format!("保存到系统凭据库失败: {e}")))
    }
}

/// 将旧版本存在 SQLite 中的明文 Key 一次性迁移到系统凭据库。
/// 只有写入凭据库成功后才删除旧值，避免升级过程中丢失配置。
pub async fn migrate_legacy_api_key(svc: &Services) -> Result<bool> {
    let Some(value) = svc.get_setting("llm_api_key").await? else {
        return Ok(false);
    };
    let value = value.trim_matches('"').trim();
    if value.is_empty() {
        svc.delete_setting("llm_api_key").await?;
        return Ok(false);
    }
    save_api_key(value)?;
    svc.delete_setting("llm_api_key").await?;
    Ok(true)
}

/// 从应用设置与调用方显式提供的凭据读取 LLM 配置。
/// 不在这里主动访问系统凭据库，避免测试或临时数据库继承真实用户密钥。
pub async fn config_from_settings(
    svc: &Services,
    injected_api_key: Option<String>,
) -> Option<LlmConfig> {
    async fn read_setting(svc: &Services, key: &str) -> Option<String> {
        svc.get_setting(key)
            .await
            .ok()
            .flatten()
            .map(|v| v.trim_matches('"').to_string())
            .filter(|v| !v.is_empty())
    }
    // 兼容还没来得及迁移的旧数据库；正式 App 会显式注入 Keychain 值。
    let api_key = match injected_api_key.filter(|value| !value.trim().is_empty()) {
        Some(value) => value,
        None => read_setting(svc, "llm_api_key").await?,
    };
    let base_url = read_setting(svc, "llm_base_url")
        .await
        .unwrap_or_else(|| "https://api.openai.com/v1".into());
    let model = read_setting(svc, "llm_model")
        .await
        .unwrap_or_else(|| "gpt-4o-mini".into());
    Some(LlmConfig {
        base_url,
        api_key,
        model,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct ExtractedJob {
    pub company_name: String,
    pub position_title: String,
    pub work_location: String,
    pub jd_text: String,
}

pub fn system_prompt() -> &'static str {
    "你是招聘信息抽取助手。从给定的招聘网页内容中抽取结构化信息，只输出一个 JSON 对象，\
     不要输出任何其他文字、解释或 markdown 代码块围栏。JSON 字段（键必须完全一致）：\n\
     {\"companyName\": \"公司名称\", \"positionTitle\": \"职位名称\", \"workLocation\": \"工作城市\", \"jdText\": \"清洗后的职位描述\"}\n\
     规则：\n\
     1. companyName：招聘的公司本身（如\"阿里巴巴\"\"美团\"），绝不要输出招聘平台/网站名（如\"牛客\"\"阿里巴巴校园招聘\"这类站点标题）\n\
     2. positionTitle：该页面的职位名称（如\"AI应用研发工程师\"）\n\
     3. workLocation：工作城市，多个用 / 分隔（如\"北京/广州/杭州\"），页面没有则输出空字符串\n\
     4. jdText：只保留与该职位直接相关的内容（职位描述/岗位职责/任职要求/加分项等），\
        删除导航菜单、登录、分享按钮、页脚、版权、其他职位推荐、业务列表等一切无关信息；\
        保留原有条目编号与换行结构，保持完整不要摘要"
}

pub fn build_user_prompt(title: &str, url: &str, content: &str) -> String {
    let content: String = content.chars().take(12000).collect();
    format!("网页标题：{title}\n网址：{url}\n\n正文内容：\n{content}")
}

/// 宽容解析：剥掉 markdown 围栏与前后杂质，取第一个完整 JSON 对象
pub fn parse_extraction(raw: &str) -> Result<ExtractedJob> {
    let s = raw.trim();
    let start = s
        .find('{')
        .ok_or_else(|| Error::Msg("LLM 输出中没有 JSON".into()))?;
    let end = s
        .rfind('}')
        .ok_or_else(|| Error::Msg("LLM 输出 JSON 不完整".into()))?;
    if end < start {
        return Err(Error::Msg("LLM 输出 JSON 不完整".into()));
    }
    let json = &s[start..=end];
    let parsed: ExtractedJob = serde_json::from_str(json)
        .map_err(|e| Error::Msg(format!("LLM 输出 JSON 解析失败: {e}")))?;
    Ok(parsed)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .expect("构建 HTTP 客户端失败")
}

async fn chat(cfg: &LlmConfig, user_content: &str, max_tokens: u32) -> Result<String> {
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let make_body = |no_think: bool| {
        let mut v = serde_json::json!({
            "model": cfg.model,
            "temperature": 0,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt()},
                {"role": "user", "content": user_content}
            ]
        });
        if no_think {
            // 关闭思考模式提速：DeepSeek/Qwen 系用 enable_thinking，OpenAI 系用 reasoning_effort。
            // 服务端一般忽略不认识的字段；个别实现会 4xx，此时去掉扩展参数重试一次。
            v["enable_thinking"] = serde_json::json!(false);
            v["reasoning_effort"] = serde_json::json!("none");
        }
        v
    };
    let send = |body: serde_json::Value| {
        let url = url.clone();
        let key = cfg.api_key.clone();
        async move {
            client()
                .post(&url)
                .bearer_auth(&key)
                .json(&body)
                .send()
                .await
                .map_err(|e| Error::Msg(format!("LLM 请求失败: {e}")))
        }
    };
    let mut resp = send(make_body(true)).await?;
    if matches!(resp.status().as_u16(), 400 | 422) {
        resp = send(make_body(false)).await?;
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let brief: String = text.chars().take(300).collect();
        return Err(Error::Msg(format!("LLM 服务返回 {status}: {brief}")));
    }
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Msg(format!("LLM 响应解析失败: {e}")))?;
    data["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| Error::Msg("LLM 响应缺少 content".into()))
}

/// 抽取招聘信息（联网调用）
pub async fn extract(
    cfg: &LlmConfig,
    title: &str,
    url: &str,
    content: &str,
) -> Result<ExtractedJob> {
    let raw = chat(cfg, &build_user_prompt(title, url, content), 4000).await?;
    let mut job = parse_extraction(&raw)?;
    job.company_name = job.company_name.trim().to_string();
    job.position_title = job.position_title.trim().to_string();
    job.work_location = job.work_location.trim().to_string();
    Ok(job)
}

/// 连通性测试
pub async fn ping(cfg: &LlmConfig) -> Result<String> {
    let raw = chat(cfg, "请只回复两个字：正常", 16).await?;
    Ok(raw.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_plain_json() {
        let j = parse_extraction(
            r#"{"companyName":"阿里巴巴","positionTitle":"AI应用研发工程师","workLocation":"北京/杭州","jdText":"职责…"}"#,
        )
        .unwrap();
        assert_eq!(j.company_name, "阿里巴巴");
        assert_eq!(j.work_location, "北京/杭州");
    }

    #[test]
    fn parse_fenced_and_noisy_output() {
        let raw = "好的，以下是抽取结果：\n```json\n{\"companyName\":\"美团\",\"positionTitle\":\"后端\",\"workLocation\":\"\",\"jdText\":\"x\"}\n```\n希望有帮助";
        let j = parse_extraction(raw).unwrap();
        assert_eq!(j.company_name, "美团");
        assert_eq!(j.work_location, "");
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_extraction("抱歉我无法处理").is_err());
        assert!(parse_extraction("{\"companyName\":").is_err());
    }

    #[test]
    fn prompt_contains_context_and_rules() {
        let p = build_user_prompt("某职位 - 某官网", "https://x.com/j/1", "正文内容片段");
        assert!(p.contains("某职位 - 某官网"));
        assert!(p.contains("https://x.com/j/1"));
        assert!(p.contains("正文内容片段"));
        let sp = system_prompt();
        assert!(sp.contains("companyName") && sp.contains("绝不要输出招聘平台"));
    }

    #[test]
    fn config_requires_key() {
        // 无 key 时 config_from_settings 应返回 None——由集成环境验证；这里验证 is_configured
        let cfg = LlmConfig {
            base_url: "https://x/v1".into(),
            api_key: String::new(),
            model: "m".into(),
        };
        assert!(!cfg.is_configured());
    }
}
