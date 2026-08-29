//! 全量导出 / 导入（JSON）。表名列名白名单校验，导入为覆盖式（先清后插，事务内）。

use serde_json::{json, Map, Value};
use sqlx::{Column, Row, SqlitePool};
use std::collections::BTreeMap;
use std::path::Path;

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
    "setting",
    "dictionary",
    "custom_event_type",
];

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

pub async fn export_to_json(pool: &SqlitePool, path: &Path) -> Result<u64> {
    let mut tables = Map::new();
    let mut total = 0u64;
    for t in TABLES {
        let rows = sqlx::query(&format!("SELECT * FROM {t}")).fetch_all(pool).await?;
        let arr: Vec<Value> = rows.iter().map(row_to_json).collect();
        total += arr.len() as u64;
        tables.insert(t.to_string(), Value::Array(arr));
    }
    let doc = json!({
        "format": "findyourjob.export",
        "version": 1,
        "exported_at": now_ts(),
        "tables": Value::Object(tables),
    });
    std::fs::write(path, serde_json::to_vec_pretty(&doc)?)?;
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
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_' || c.is_ascii_digit())
}

pub async fn import_from_json(pool: &SqlitePool, path: &Path) -> Result<ImportSummary> {
    let raw = std::fs::read(path)?;
    let doc: Value = serde_json::from_slice(&raw)
        .map_err(|e| Error::Invalid(format!("无法解析导出文件: {e}")))?;
    if doc.get("format").and_then(|f| f.as_str()) != Some("findyourjob.export") {
        return Err(Error::Invalid("不是 FindYourJob 的导出文件".into()));
    }

    let mut tx = pool.begin().await?;
    for t in TABLES.iter().rev() {
        sqlx::query(&format!("DELETE FROM {t}")).execute(&mut *tx).await?;
    }

    let mut counts = BTreeMap::new();
    let mut total = 0u64;
    for t in TABLES {
        let Some(Value::Array(rows)) = doc.get("tables").and_then(|ts| ts.get(t)) else {
            continue;
        };
        for row in rows {
            let obj = row
                .as_object()
                .ok_or_else(|| Error::Invalid(format!("{t} 表存在非法行")))?;
            let cols: Vec<&String> = obj.keys().collect();
            if cols.iter().any(|c| !valid_ident(c)) {
                return Err(Error::Invalid(format!("{t} 表存在非法列名")));
            }
            let col_sql = cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", ");
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
    tx.commit().await?;
    Ok(ImportSummary { total, counts })
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

        let out = dir.path().join("backup.json");
        let n = export_to_json(&pool, &out).await.unwrap();
        assert!(n >= 7, "至少包含公司/投递/2事件/设置/字典种子等，实际 {n}");

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
        let summary = import_from_json(&pool2, &out).await.unwrap();
        assert_eq!(summary.total, n, "导入行数应与导出一致");

        // 覆盖验证：旧数据没了，新数据状态正确
        let apps = s2.list_applications(&Default::default()).await.unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].application.company_name, "回环科技");
        assert_eq!(apps[0].application.status, crate::models::Status::Written);
        let onboarded = s2.get_setting("onboarded").await.unwrap();
        assert_eq!(onboarded.as_deref(), Some("true"));
    }
}
