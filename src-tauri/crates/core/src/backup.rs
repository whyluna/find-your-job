//! 全量导出 / 导入（JSON）。
//!
//! v2 备份除全部数据库表外，还以 base64 内嵌简历、附件和 eml 原文件，
//! 因此单个 JSON 可以在新机器的应用数据目录中独立恢复。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{Column, Row, SqlitePool};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::entities::now_ts;
use crate::error::{Error, Result};

/// 导出顺序 = 父表在前（导入插入时满足外键）；删除时倒序
pub const TABLES: &[&str] = &[
    "company",
    "resume_version",
    "contact",
    "application",
    "application_event",
    "interview",
    "interview_question",
    "attachment",
    "reminder",
    "email_account",
    "email_parse_log",
    "setting",
    "dictionary",
    "custom_event_type",
];

/// 凭据只属于当前设备，不能进入可复制、可分享的明文 JSON 备份。
const SENSITIVE_SETTING_KEYS: &[&str] = &["llm_api_key", "local_api_token"];

fn strip_sensitive_settings(doc: &mut Value) {
    let Some(rows) = doc
        .get_mut("tables")
        .and_then(|tables| tables.get_mut("setting"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    rows.retain(|row| {
        row.get("key")
            .and_then(Value::as_str)
            .map(|key| !SENSITIVE_SETTING_KEYS.contains(&key))
            .unwrap_or(true)
    });
}

/// v1 导出中尚未包含邮件表和实体文件，仅用于兼容旧备份。
const LEGACY_TABLES: &[&str] = &[
    "company",
    "resume_version",
    "contact",
    "application",
    "application_event",
    "interview",
    "interview_question",
    "attachment",
    "reminder",
    "setting",
    "dictionary",
    "custom_event_type",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedFile {
    kind: String,
    owner_id: String,
    file_name: String,
    data_base64: String,
}

type FileReplacementMap = HashMap<(String, String), String>;
type StagedFiles = (FileReplacementMap, Vec<PathBuf>);

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub total: u64,
    pub counts: BTreeMap<String, usize>,
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut obj = Map::new();
    for col in row.columns() {
        let name = col.name();
        let v: Value = if let Ok(s) = row.try_get::<Option<String>, _>(name) {
            s.map(Value::String).unwrap_or(Value::Null)
        } else if let Ok(i) = row.try_get::<Option<i64>, _>(name) {
            i.map(Value::from).unwrap_or(Value::Null)
        } else if let Ok(f) = row.try_get::<Option<f64>, _>(name) {
            f.map(Value::from).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        obj.insert(name.to_string(), v);
    }
    Value::Object(obj)
}

fn embed_file(
    kind: &str,
    owner_id: String,
    file_name: String,
    path: String,
) -> Result<EmbeddedFile> {
    if path.trim().is_empty() {
        return Err(Error::Invalid(format!("{kind} {owner_id} 的文件路径为空")));
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| Error::Invalid(format!("无法打包 {kind} {owner_id} 的文件 {path}: {e}")))?;
    Ok(EmbeddedFile {
        kind: kind.to_string(),
        owner_id,
        file_name,
        data_base64: BASE64.encode(bytes),
    })
}

async fn collect_embedded_files(pool: &SqlitePool) -> Result<Vec<EmbeddedFile>> {
    let mut files = Vec::new();
    let resumes: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, file_name, file_path FROM resume_version")
            .fetch_all(pool)
            .await?;
    for (id, name, path) in resumes {
        files.push(embed_file("resume", id, name, path)?);
    }

    let attachments: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, file_name, file_path FROM attachment")
            .fetch_all(pool)
            .await?;
    for (id, name, path) in attachments {
        files.push(embed_file("attachment", id, name, path)?);
    }

    let emails: Vec<(String, String, Option<String>)> =
        sqlx::query_as("SELECT id, message_id, raw_path FROM email_parse_log")
            .fetch_all(pool)
            .await?;
    for (id, message_id, raw_path) in emails {
        if let Some(path) = raw_path.filter(|p| !p.trim().is_empty()) {
            let name = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{message_id}.eml"));
            files.push(embed_file("email", id, name, path)?);
        }
    }
    Ok(files)
}

pub async fn export_to_json(pool: &SqlitePool, path: &Path) -> Result<u64> {
    let mut tables = Map::new();
    let mut total = 0u64;
    for t in TABLES {
        let rows = sqlx::query(&format!("SELECT * FROM {t}"))
            .fetch_all(pool)
            .await?;
        let mut arr: Vec<Value> = rows.iter().map(row_to_json).collect();
        if *t == "setting" {
            arr.retain(|row| {
                row.get("key")
                    .and_then(Value::as_str)
                    .map(|key| !SENSITIVE_SETTING_KEYS.contains(&key))
                    .unwrap_or(true)
            });
        }
        total += arr.len() as u64;
        tables.insert(t.to_string(), Value::Array(arr));
    }
    let files = collect_embedded_files(pool).await?;
    let doc = json!({
        "format": "findyourjob.export",
        "version": 2,
        "exported_at": now_ts(),
        "tables": Value::Object(tables),
        "files": files,
        "omitted_secrets": ["llm_api_key", "local_api_token"],
    });
    let bytes = serde_json::to_vec_pretty(&doc)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = parent.join(format!(".findyourjob-export-{}.tmp", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(total)
}

/// 绑定值（serde Serialize 含泛型方法不能做 trait object，用枚举分发）
enum BindVal {
    Str(String),
    Int(i64),
    Float(f64),
    Null,
}

fn json_bind_value(v: &Value) -> BindVal {
    match v {
        Value::String(s) => BindVal::Str(s.clone()),
        Value::Number(n) => match n.as_i64() {
            Some(i) => BindVal::Int(i),
            None => BindVal::Float(n.as_f64().unwrap_or(0.0)),
        },
        Value::Bool(b) => BindVal::Int(if *b { 1 } else { 0 }),
        _ => BindVal::Null,
    }
}

fn valid_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c == '_' || c.is_ascii_digit())
}

async fn validate_document(pool: &SqlitePool, doc: &Value, version: u64) -> Result<()> {
    let tables = doc
        .get("tables")
        .and_then(Value::as_object)
        .ok_or_else(|| Error::Invalid("备份文件缺少 tables 对象".into()))?;
    let required = if version == 1 { LEGACY_TABLES } else { TABLES };
    for table in required {
        let rows = tables
            .get(*table)
            .and_then(Value::as_array)
            .ok_or_else(|| Error::Invalid(format!("备份文件缺少必需表: {table}")))?;
        let schema_rows = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await?;
        let allowed: HashSet<String> = schema_rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect();
        for row in rows {
            let obj = row
                .as_object()
                .ok_or_else(|| Error::Invalid(format!("{table} 表存在非法行")))?;
            if obj.is_empty() {
                return Err(Error::Invalid(format!("{table} 表存在空行")));
            }
            if let Some(column) = obj
                .keys()
                .find(|c| !valid_ident(c) || !allowed.contains(*c))
            {
                return Err(Error::Invalid(format!("{table} 表存在非法列名: {column}")));
            }
        }
    }
    Ok(())
}

fn table_ids(doc: &Value, table: &str) -> Result<HashSet<String>> {
    let rows = doc["tables"][table]
        .as_array()
        .ok_or_else(|| Error::Invalid(format!("备份文件缺少表: {table}")))?;
    rows.iter()
        .map(|row| {
            row.get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| Error::Invalid(format!("{table} 表存在缺少 id 的行")))
        })
        .collect()
}

fn validate_embedded_files(doc: &Value, files: &[EmbeddedFile]) -> Result<()> {
    let resume_ids = table_ids(doc, "resume_version")?;
    let attachment_ids = table_ids(doc, "attachment")?;
    let email_ids = table_ids(doc, "email_parse_log")?;
    let mut seen = HashSet::new();
    for file in files {
        let owners = match file.kind.as_str() {
            "resume" => &resume_ids,
            "attachment" => &attachment_ids,
            "email" => &email_ids,
            other => return Err(Error::Invalid(format!("备份中存在未知文件类型: {other}"))),
        };
        if !owners.contains(&file.owner_id) {
            return Err(Error::Invalid(format!(
                "备份文件 {}:{} 找不到对应数据行",
                file.kind, file.owner_id
            )));
        }
        if !seen.insert((file.kind.clone(), file.owner_id.clone())) {
            return Err(Error::Invalid(format!(
                "备份中存在重复文件 {}:{}",
                file.kind, file.owner_id
            )));
        }
    }

    for (table, kind, path_col) in [
        ("resume_version", "resume", "file_path"),
        ("attachment", "attachment", "file_path"),
        ("email_parse_log", "email", "raw_path"),
    ] {
        let rows = doc["tables"][table].as_array().unwrap();
        for row in rows {
            let Some(path) = row
                .get(path_col)
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty())
            else {
                continue;
            };
            let id = row.get("id").and_then(Value::as_str).unwrap_or_default();
            if !seen.contains(&(kind.to_string(), id.to_string())) {
                return Err(Error::Invalid(format!(
                    "{table} {id} 引用了文件 {path}，但备份未包含文件内容"
                )));
            }
        }
    }
    Ok(())
}

fn safe_extension(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty() && e.len() <= 12 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn stage_embedded_files(files: &[EmbeddedFile], data_dir: &Path) -> Result<StagedFiles> {
    let decoded: Vec<(&EmbeddedFile, Vec<u8>)> = files
        .iter()
        .map(|file| {
            BASE64
                .decode(&file.data_base64)
                .map(|bytes| (file, bytes))
                .map_err(|e| {
                    Error::Invalid(format!(
                        "备份文件 {}:{} 的 base64 内容无效: {e}",
                        file.kind, file.owner_id
                    ))
                })
        })
        .collect::<Result<_>>()?;

    let mut replacements = HashMap::new();
    let mut created = Vec::new();
    for (file, bytes) in decoded {
        let subdir = match file.kind.as_str() {
            "resume" => "resumes",
            "attachment" => "attachments",
            "email" => "emails",
            _ => unreachable!("文件类型已在写入前校验"),
        };
        let dir = data_dir.join("uploads").join(subdir);
        if let Err(e) = std::fs::create_dir_all(&dir) {
            for path in &created {
                let _ = std::fs::remove_file(path);
            }
            return Err(e.into());
        }
        let path = dir.join(format!(
            "{}{}",
            uuid::Uuid::new_v4(),
            safe_extension(&file.file_name)
        ));
        if let Err(e) = std::fs::write(&path, bytes) {
            for path in &created {
                let _ = std::fs::remove_file(path);
            }
            return Err(e.into());
        }
        replacements.insert(
            (file.kind.clone(), file.owner_id.clone()),
            path.display().to_string(),
        );
        created.push(path);
    }
    Ok((replacements, created))
}

fn rewrite_embedded_paths(doc: &mut Value, replacements: &FileReplacementMap) -> Result<()> {
    for (table, kind, path_col) in [
        ("resume_version", "resume", "file_path"),
        ("attachment", "attachment", "file_path"),
        ("email_parse_log", "email", "raw_path"),
    ] {
        let rows = doc["tables"][table]
            .as_array_mut()
            .ok_or_else(|| Error::Invalid(format!("备份文件缺少表: {table}")))?;
        for row in rows {
            let Some(obj) = row.as_object_mut() else {
                continue;
            };
            let id = obj.get("id").and_then(Value::as_str).unwrap_or_default();
            if let Some(path) = replacements.get(&(kind.to_string(), id.to_string())) {
                obj.insert(path_col.to_string(), Value::String(path.clone()));
            }
        }
    }
    Ok(())
}

async fn current_file_paths(pool: &SqlitePool) -> Result<Vec<String>> {
    let mut paths: Vec<String> = sqlx::query_scalar("SELECT file_path FROM resume_version")
        .fetch_all(pool)
        .await?;
    paths.extend(
        sqlx::query_scalar::<_, String>("SELECT file_path FROM attachment")
            .fetch_all(pool)
            .await?,
    );
    paths.extend(
        sqlx::query_scalar::<_, String>(
            "SELECT raw_path FROM email_parse_log WHERE raw_path IS NOT NULL AND raw_path != ''",
        )
        .fetch_all(pool)
        .await?,
    );
    Ok(paths)
}

fn remove_old_managed_files(data_dir: &Path, old_paths: &[String], keep: &[PathBuf]) {
    let Ok(root) = std::fs::canonicalize(data_dir.join("uploads")) else {
        return;
    };
    let keep: HashSet<PathBuf> = keep
        .iter()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect();
    for path in old_paths {
        let Ok(canonical) = std::fs::canonicalize(path) else {
            continue;
        };
        if canonical.starts_with(&root) && !keep.contains(&canonical) {
            let _ = std::fs::remove_file(canonical);
        }
    }
}

pub async fn import_from_json(
    pool: &SqlitePool,
    path: &Path,
    data_dir: &Path,
) -> Result<ImportSummary> {
    let raw = std::fs::read(path)?;
    let mut doc: Value = serde_json::from_slice(&raw)
        .map_err(|e| Error::Invalid(format!("无法解析导出文件: {e}")))?;
    if doc.get("format").and_then(|f| f.as_str()) != Some("findyourjob.export") {
        return Err(Error::Invalid("不是 FindYourJob 的导出文件".into()));
    }
    let version = doc
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| Error::Invalid("备份文件缺少版本号".into()))?;
    if !matches!(version, 1 | 2) {
        return Err(Error::Invalid(format!("不支持的备份版本: {version}")));
    }
    // 旧备份可能包含明文密钥；恢复时也绝不把它们重新写进 SQLite。
    strip_sensitive_settings(&mut doc);
    validate_document(pool, &doc, version).await?;

    let old_paths = current_file_paths(pool).await?;
    let (_replacements, created_paths) = if version == 2 {
        let files: Vec<EmbeddedFile> = serde_json::from_value(
            doc.get("files")
                .cloned()
                .ok_or_else(|| Error::Invalid("v2 备份文件缺少 files 数组".into()))?,
        )
        .map_err(|e| Error::Invalid(format!("无法解析备份文件列表: {e}")))?;
        validate_embedded_files(&doc, &files)?;
        let staged = stage_embedded_files(&files, data_dir)?;
        rewrite_embedded_paths(&mut doc, &staged.0)?;
        staged
    } else {
        (HashMap::new(), Vec::new())
    };

    let import_result: Result<ImportSummary> = async {
        let mut tx = pool.begin().await?;
        for t in TABLES.iter().rev() {
            sqlx::query(&format!("DELETE FROM {t}"))
                .execute(&mut *tx)
                .await?;
        }

        let mut counts = BTreeMap::new();
        let mut total = 0u64;
        for t in TABLES {
            let Some(Value::Array(rows)) = doc.get("tables").and_then(|ts| ts.get(t)) else {
                counts.insert(t.to_string(), 0);
                continue;
            };
            for row in rows {
                let obj = row.as_object().expect("已在开启事务前验证数据行");
                let cols: Vec<&String> = obj.keys().collect();
                let col_sql = cols
                    .iter()
                    .map(|c| c.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                let placeholders = vec!["?"; cols.len()].join(", ");
                let sql = format!("INSERT INTO {t} ({col_sql}) VALUES ({placeholders})");
                let mut q = sqlx::query(&sql);
                for c in &cols {
                    q = match json_bind_value(&obj[c.as_str()]) {
                        BindVal::Str(s) => q.bind(s),
                        BindVal::Int(i) => q.bind(i),
                        BindVal::Float(f) => q.bind(f),
                        BindVal::Null => q.bind(Option::<String>::None),
                    };
                }
                q.execute(&mut *tx).await?;
            }
            counts.insert(t.to_string(), rows.len());
            total += rows.len() as u64;
        }
        let violations = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&mut *tx)
            .await?;
        if !violations.is_empty() {
            return Err(Error::Invalid(format!(
                "备份存在 {} 处外键不一致，已取消恢复",
                violations.len()
            )));
        }
        tx.commit().await?;
        Ok(ImportSummary { total, counts })
    }
    .await;

    if import_result.is_err() {
        for path in &created_paths {
            let _ = std::fs::remove_file(path);
        }
    } else if version == 2 {
        remove_old_managed_files(data_dir, &old_paths, &created_paths);
    }
    import_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;
    use crate::services::{AddEventInput, CreateApplicationInput, Services};

    #[tokio::test]
    async fn export_import_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let pool = init_pool(&dir.path().join("a.db")).await.unwrap();
        let s = Services::new(pool.clone());
        // 造数据：公司+投递+事件+面试+题目+设置
        let app = s
            .create_application(CreateApplicationInput {
                company_name: "回环科技".into(),
                company_website: None,
                company_careers_url: None,
                position_title: "Rust 工程师".into(),
                department: Some("基础架构".into()),
                work_location: Some("杭州".into()),
                channel: Some("BOSS".into()),
                batch: Some("FORMAL".into()),
                priority: Some("HIGH".into()),
                applied: Some(true),
                applied_date: None,
                job_url: None,
                jd_text: Some("负责桌面应用".into()),
                salary_range: None,
                tags: vec!["想去的".into()],
                resume_version_id: None,
                notes: None,
            })
            .await
            .unwrap();
        s.add_event(AddEventInput {
            application_id: app.id.clone(),
            event_type: "WRITTEN_INVITED".into(),
            occurred_at: None,
            deadline: Some(chrono::Utc::now() + chrono::Duration::days(3)),
            result: None,
            note: Some("牛客笔试".into()),
            source: None,
        })
        .await
        .unwrap();
        s.set_setting("onboarded", "true").await.unwrap();
        s.set_setting("llm_api_key", "\"secret-that-must-not-leave-device\"")
            .await
            .unwrap();
        s.set_setting("local_api_token", "\"local-token\"")
            .await
            .unwrap();

        // v2 备份必须将实体文件一并嵌入，并在新数据目录重建路径。
        let source_data = dir.path().join("source-data");
        let source_resume = source_data.join("uploads/resumes/source.pdf");
        std::fs::create_dir_all(source_resume.parent().unwrap()).unwrap();
        std::fs::write(&source_resume, b"resume-pdf-content").unwrap();
        s.insert_resume(
            "Rust 岗版",
            Some("Rust"),
            "resume.pdf",
            &source_resume.display().to_string(),
            Some(18),
            None,
        )
        .await
        .unwrap();

        let source_eml = source_data.join("uploads/emails/source.eml");
        std::fs::create_dir_all(source_eml.parent().unwrap()).unwrap();
        std::fs::write(&source_eml, b"Subject: test\n\nmail body").unwrap();
        sqlx::query(
            "INSERT INTO email_account (id, host, username) VALUES ('mail-account', 'manual', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_parse_log \
             (id, email_account_id, message_id, received_at, from_address, raw_path) \
             VALUES ('mail-log', 'mail-account', 'message-1', ?, 'hr@example.com', ?)",
        )
        .bind(now_ts())
        .bind(source_eml.display().to_string())
        .execute(&pool)
        .await
        .unwrap();

        let out = dir.path().join("backup.json");
        let n = export_to_json(&pool, &out).await.unwrap();
        assert!(n >= 7, "至少包含公司/投递/2事件/设置/字典种子等，实际 {n}");
        let exported: Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        let setting_keys: Vec<&str> = exported["tables"]["setting"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| row["key"].as_str())
            .collect();
        assert!(!setting_keys.contains(&"llm_api_key"));
        assert!(!setting_keys.contains(&"local_api_token"));
        let raw_export = std::fs::read_to_string(&out).unwrap();
        assert!(!raw_export.contains("secret-that-must-not-leave-device"));
        assert!(!raw_export.contains("local-token"));

        // 新库导入
        let pool2 = init_pool(&dir.path().join("b.db")).await.unwrap();
        // 先让 b 库有一点数据，导入覆盖后应清掉
        let s2 = Services::new(pool2.clone());
        s2.create_application(CreateApplicationInput {
            company_name: "将被覆盖".into(),
            company_website: None,
            company_careers_url: None,
            position_title: "x".into(),
            department: None,
            work_location: None,
            channel: None,
            batch: None,
            priority: None,
            applied: Some(false),
            applied_date: None,
            job_url: None,
            jd_text: None,
            salary_range: None,
            tags: vec![],
            resume_version_id: None,
            notes: None,
        })
        .await
        .unwrap();
        let restored_data = dir.path().join("restored-data");
        let summary = import_from_json(&pool2, &out, &restored_data)
            .await
            .unwrap();
        assert_eq!(summary.total, n, "导入行数应与导出一致");

        // 覆盖验证：旧数据没了，新数据状态正确
        let apps = s2.list_applications(&Default::default()).await.unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].application.company_name, "回环科技");
        assert_eq!(apps[0].application.status, crate::models::Status::Written);
        let onboarded = s2.get_setting("onboarded").await.unwrap();
        assert_eq!(onboarded.as_deref(), Some("true"));
        assert_eq!(summary.counts.get("email_account"), Some(&1));
        assert_eq!(summary.counts.get("email_parse_log"), Some(&1));

        let restored_resume = s2.list_resumes().await.unwrap().pop().unwrap();
        assert!(Path::new(&restored_resume.file_path).starts_with(&restored_data));
        assert_eq!(
            std::fs::read(restored_resume.file_path).unwrap(),
            b"resume-pdf-content"
        );
        let restored_eml: String =
            sqlx::query_scalar("SELECT raw_path FROM email_parse_log WHERE id = 'mail-log'")
                .fetch_one(&pool2)
                .await
                .unwrap();
        assert!(Path::new(&restored_eml).starts_with(&restored_data));
        assert_eq!(
            std::fs::read(restored_eml).unwrap(),
            b"Subject: test\n\nmail body"
        );
    }

    #[tokio::test]
    async fn incomplete_backup_is_rejected_before_current_data_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let pool = init_pool(&dir.path().join("live.db")).await.unwrap();
        let services = Services::new(pool.clone());
        services
            .create_application(CreateApplicationInput {
                company_name: "不得丢失".into(),
                company_website: None,
                company_careers_url: None,
                position_title: "测试".into(),
                department: None,
                work_location: None,
                channel: None,
                batch: None,
                priority: None,
                applied: Some(false),
                applied_date: None,
                job_url: None,
                jd_text: None,
                salary_range: None,
                tags: vec![],
                resume_version_id: None,
                notes: None,
            })
            .await
            .unwrap();
        let bad = dir.path().join("bad.json");
        std::fs::write(
            &bad,
            br#"{"format":"findyourjob.export","version":2,"tables":{},"files":[]}"#,
        )
        .unwrap();

        let result = import_from_json(&pool, &bad, &dir.path().join("data")).await;
        assert!(result.is_err());
        let apps = services
            .list_applications(&Default::default())
            .await
            .unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].application.company_name, "不得丢失");
    }
}
