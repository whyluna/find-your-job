//! 按招聘季关注公司。所有状态与查看记录独立于投递事件。
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};
use uuid::Uuid;

use crate::entities::{now_ts, parse_ts, ts};
use crate::services::Services;
use crate::{Error, Result};

const STATUSES: &[&str] = &["UNKNOWN", "NOT_OPEN", "OPEN", "CLOSED"];
const SELECT_WATCH: &str = "SELECT w.*, c.name AS company_name, c.website, c.careers_url, \
    (SELECT COUNT(*) FROM application a WHERE a.company_id = c.id) AS application_count \
    FROM company_watch w JOIN company c ON c.id = w.company_id";

/// 精确全名优先；别名有歧义时要求明确选择，不凭招聘域名合并公司。
pub(crate) async fn matching_company(
    conn: &mut SqliteConnection,
    name: &str,
) -> Result<Option<String>> {
    let exact: Option<String> = sqlx::query_scalar("SELECT id FROM company WHERE name=?")
        .bind(name.trim())
        .fetch_optional(&mut *conn)
        .await?;
    if exact.is_some() {
        return Ok(exact);
    }
    let matches: Vec<String> = sqlx::query_scalar("SELECT DISTINCT c.id FROM company c LEFT JOIN json_each(CASE WHEN json_valid(c.aliases) THEN c.aliases ELSE '[]' END) a ON true WHERE lower(trim(c.name))=lower(?) OR lower(trim(a.value))=lower(?)")
        .bind(name.trim()).bind(name.trim()).fetch_all(conn).await?;
    if matches.len() > 1 {
        return Err(Error::Invalid(
            "名称匹配多家公司，请使用完整公司名称或明确选择已有公司".into(),
        ));
    }
    Ok(matches.into_iter().next())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyWatch {
    pub id: String,
    pub company_id: String,
    pub company_name: String,
    pub website: Option<String>,
    pub careers_url: Option<String>,
    pub application_count: i64,
    pub year: i64,
    pub season: String,
    pub status: String,
    pub recruitment_url: Option<String>,
    pub target_role: Option<String>,
    pub target_location: Option<String>,
    pub notes: Option<String>,
    pub interval_days: Option<i64>,
    pub next_check_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub paused: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl CompanyWatch {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self> {
        Ok(Self {
            id: row.try_get("id")?,
            company_id: row.try_get("company_id")?,
            company_name: row.try_get("company_name")?,
            website: row.try_get("website")?,
            careers_url: row.try_get("careers_url")?,
            application_count: row.try_get("application_count")?,
            year: row.try_get("year")?,
            season: row.try_get("season")?,
            status: row.try_get("status")?,
            recruitment_url: row.try_get("recruitment_url")?,
            target_role: row.try_get("target_role")?,
            target_location: row.try_get("target_location")?,
            notes: row.try_get("notes")?,
            interval_days: row.try_get("interval_days")?,
            next_check_at: row.try_get("next_check_at")?,
            last_checked_at: row.try_get("last_checked_at")?,
            paused: row.try_get("paused")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchConfig {
    pub year: i64,
    pub season: String,
    pub status: String,
    pub recruitment_url: Option<String>,
    pub target_role: Option<String>,
    pub target_location: Option<String>,
    pub notes: Option<String>,
    pub interval_days: Option<i64>,
    pub next_check_at: Option<String>,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowCompanyInput {
    pub company_id: Option<String>,
    pub company_name: String,
    pub website: Option<String>,
    pub careers_url: Option<String>,
    #[serde(flatten)]
    pub config: WatchConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowCompanyResult {
    pub watch: CompanyWatch,
    pub created: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchActionInput {
    pub action: String,
    pub status: Option<String>,
    pub days: Option<i64>,
    pub note: Option<String>,
    pub evidence_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchCheck {
    pub id: String,
    pub watch_id: String,
    pub action: String,
    pub status: String,
    pub recorded_at: String,
    pub next_check_at: Option<String>,
    pub note: Option<String>,
    pub evidence_url: Option<String>,
}

fn optional_text(value: Option<String>, limit: usize) -> Result<Option<String>> {
    let value = value.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
    if value.as_ref().is_some_and(|s| s.chars().count() > limit) {
        return Err(Error::Invalid(format!("内容不能超过 {limit} 字")));
    }
    Ok(value)
}

pub fn website_url(value: Option<String>) -> Result<Option<String>> {
    let Some(value) = optional_text(value, 8192)? else {
        return Ok(None);
    };
    let normalized = if value.contains("://") {
        value
    } else {
        format!("https://{value}")
    };
    let url = url::Url::parse(&normalized).map_err(|_| Error::Invalid("网站地址无效".into()))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Invalid(
            "网站只支持不含账号密码的 HTTP / HTTPS 地址".into(),
        ));
    }
    Ok(Some(url.to_string()))
}

fn next_date(days: Option<i64>) -> Option<String> {
    days.map(|days| ts(&(Utc::now() + Duration::days(days))))
}

fn validate_config(mut c: WatchConfig) -> Result<WatchConfig> {
    if !(2000..=2200).contains(&c.year)
        || !["AUTUMN", "SPRING", "INTERNSHIP"].contains(&c.season.as_str())
    {
        return Err(Error::Invalid("请选择有效的招聘届次与招聘季".into()));
    }
    if !STATUSES.contains(&c.status.as_str()) {
        return Err(Error::Invalid("无效招聘状态".into()));
    }
    if c.interval_days
        .is_some_and(|days| !(1..=365).contains(&days))
    {
        return Err(Error::Invalid("查看周期须为 1–365 天".into()));
    }
    c.recruitment_url = website_url(c.recruitment_url)?;
    c.target_role = optional_text(c.target_role, 200)?;
    c.target_location = optional_text(c.target_location, 200)?;
    c.notes = optional_text(c.notes, 4000)?;
    c.next_check_at = match optional_text(c.next_check_at, 100)? {
        Some(value) => Some(ts(
            &parse_ts(&value).ok_or_else(|| Error::Invalid("下次查看时间无效".into()))?
        )),
        None => next_date(c.interval_days),
    };
    if c.paused || c.status == "CLOSED" {
        c.next_check_at = None;
    }
    Ok(c)
}

async fn watch_on(conn: &mut SqliteConnection, id: &str) -> Result<CompanyWatch> {
    let row = sqlx::query(&format!("{SELECT_WATCH} WHERE w.id = ?"))
        .bind(id)
        .fetch_optional(conn)
        .await?
        .ok_or_else(|| Error::Invalid("公司关注记录不存在".into()))?;
    CompanyWatch::from_row(&row)
}

async fn record(
    conn: &mut SqliteConnection,
    watch: &CompanyWatch,
    action: &str,
    note: Option<String>,
    evidence_url: Option<String>,
) -> Result<()> {
    sqlx::query("INSERT INTO company_watch_check (id,watch_id,action,status,recorded_at,next_check_at,note,evidence_url) VALUES (?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(&watch.id).bind(action).bind(&watch.status)
        .bind(now_ts()).bind(&watch.next_check_at).bind(note).bind(evidence_url).execute(conn).await?;
    Ok(())
}

impl Services {
    pub async fn list_company_watches(&self) -> Result<Vec<CompanyWatch>> {
        let rows = sqlx::query(&format!("{SELECT_WATCH} ORDER BY w.paused, w.status='CLOSED', w.next_check_at IS NULL, w.next_check_at, c.name, w.year DESC"))
            .fetch_all(&self.pool).await?;
        rows.iter().map(CompanyWatch::from_row).collect()
    }

    pub async fn get_company_watch(&self, id: &str) -> Result<CompanyWatch> {
        watch_on(&mut *self.pool.acquire().await?, id).await
    }

    pub async fn follow_company(&self, input: FollowCompanyInput) -> Result<FollowCompanyResult> {
        let c = validate_config(input.config)?;
        let name = input.company_name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(Error::Invalid("公司名称须为 1–200 字".into()));
        }
        let website = website_url(input.website)?;
        let careers_url = website_url(input.careers_url)?;
        // 从事务开始取得写锁，避免同时收录同一公司时先读后写升级锁失败。
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let company_id = if let Some(id) = input.company_id {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM company WHERE id=?)")
                    .bind(&id)
                    .fetch_one(&mut *tx)
                    .await?;
            if !exists {
                return Err(Error::Invalid("所选公司不存在，请重新选择".into()));
            }
            id
        } else {
            if let Some(id) = matching_company(&mut tx, name).await? {
                id
            } else {
                let id = Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO company (id,name,website,careers_url,created_at,updated_at) VALUES (?,?,?,?,?,?)")
                    .bind(&id).bind(name).bind(&website).bind(&careers_url).bind(now_ts()).bind(now_ts()).execute(&mut *tx).await?;
                id
            }
        };
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM company_watch WHERE company_id=? AND year=? AND season=?",
        )
        .bind(&company_id)
        .bind(c.year)
        .bind(&c.season)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(id) = existing {
            let watch = watch_on(&mut tx, &id).await?;
            tx.commit().await?;
            return Ok(FollowCompanyResult {
                watch,
                created: false,
            });
        }
        // 收录仅补充空网站，绝不覆盖用户维护过的地址；不凭共享招聘域名合并公司。
        sqlx::query("UPDATE company SET website=COALESCE(NULLIF(website,''),?), careers_url=COALESCE(NULLIF(careers_url,''),?) WHERE id=?")
            .bind(website).bind(careers_url).bind(&company_id).execute(&mut *tx).await?;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_watch (id,company_id,year,season,status,recruitment_url,target_role,target_location,notes,interval_days,next_check_at,paused,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(company_id).bind(c.year).bind(c.season).bind(c.status).bind(c.recruitment_url)
            .bind(c.target_role).bind(c.target_location).bind(c.notes).bind(c.interval_days).bind(c.next_check_at)
            .bind(c.paused).bind(now_ts()).bind(now_ts()).execute(&mut *tx).await?;
        let watch = watch_on(&mut tx, &id).await?;
        record(&mut tx, &watch, "FOLLOWED", None, None).await?;
        tx.commit().await?;
        Ok(FollowCompanyResult {
            watch,
            created: true,
        })
    }

    pub async fn update_company_watch(&self, id: &str, input: WatchConfig) -> Result<CompanyWatch> {
        let c = validate_config(input)?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let existing = watch_on(&mut tx, id).await?;
        if c.year != existing.year || c.season != existing.season {
            return Err(Error::Invalid(
                "招聘季不可覆盖；请为新的届次另建关注记录".into(),
            ));
        }
        sqlx::query("UPDATE company_watch SET status=?,recruitment_url=?,target_role=?,target_location=?,notes=?,interval_days=?,next_check_at=?,paused=?,updated_at=? WHERE id=?")
            .bind(c.status).bind(c.recruitment_url).bind(c.target_role).bind(c.target_location).bind(c.notes)
            .bind(c.interval_days).bind(c.next_check_at).bind(c.paused).bind(now_ts()).bind(id).execute(&mut *tx).await?;
        let watch = watch_on(&mut tx, id).await?;
        record(&mut tx, &watch, "EDIT", None, None).await?;
        tx.commit().await?;
        Ok(watch)
    }

    pub async fn act_on_company_watch(
        &self,
        id: &str,
        input: WatchActionInput,
    ) -> Result<CompanyWatch> {
        let note = optional_text(input.note, 4000)?;
        let evidence = website_url(input.evidence_url)?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let mut w = watch_on(&mut tx, id).await?;
        match input.action.as_str() {
            "CHECK" => {
                if w.paused {
                    return Err(Error::Invalid("请先恢复关注，再记录查看结果".into()));
                }
                let status = input
                    .status
                    .filter(|s| STATUSES.contains(&s.as_str()))
                    .ok_or_else(|| Error::Invalid("请选择本次查看结果".into()))?;
                w.status = status;
                w.last_checked_at = Some(now_ts());
                w.next_check_at = if w.status == "CLOSED" {
                    None
                } else {
                    next_date(w.interval_days)
                };
            }
            "SNOOZE" => {
                if w.paused || w.status == "CLOSED" {
                    return Err(Error::Invalid("暂停或结束的招聘无需延后提醒".into()));
                }
                let days = input
                    .days
                    .filter(|n| (1..=365).contains(n))
                    .ok_or_else(|| Error::Invalid("延后天数须为 1–365".into()))?;
                w.next_check_at = next_date(Some(days));
            }
            "PAUSE" => {
                w.paused = true;
                w.next_check_at = None;
            }
            "RESUME" => {
                w.paused = false;
                w.next_check_at = if w.status == "CLOSED" {
                    None
                } else {
                    next_date(w.interval_days)
                };
            }
            _ => return Err(Error::Invalid("无效关注操作".into())),
        }
        sqlx::query("UPDATE company_watch SET status=?,last_checked_at=?,next_check_at=?,paused=?,updated_at=? WHERE id=?")
            .bind(&w.status).bind(&w.last_checked_at).bind(&w.next_check_at).bind(w.paused).bind(now_ts()).bind(id).execute(&mut *tx).await?;
        let watch = watch_on(&mut tx, id).await?;
        record(&mut tx, &watch, &input.action, note, evidence).await?;
        tx.commit().await?;
        Ok(watch)
    }

    pub async fn list_company_watch_checks(&self, id: &str) -> Result<Vec<WatchCheck>> {
        self.get_company_watch(id).await?;
        let rows = sqlx::query("SELECT * FROM company_watch_check WHERE watch_id=? ORDER BY recorded_at DESC,id DESC LIMIT 100").bind(id).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|r| {
                Ok(WatchCheck {
                    id: r.try_get("id")?,
                    watch_id: r.try_get("watch_id")?,
                    action: r.try_get("action")?,
                    status: r.try_get("status")?,
                    recorded_at: r.try_get("recorded_at")?,
                    next_check_at: r.try_get("next_check_at")?,
                    note: r.try_get("note")?,
                    evidence_url: r.try_get("evidence_url")?,
                })
            })
            .collect()
    }

    pub async fn delete_company_watch(&self, id: &str) -> Result<()> {
        let n = sqlx::query("DELETE FROM company_watch WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(Error::Invalid("公司关注记录不存在".into()));
        }
        Ok(())
    }
}
