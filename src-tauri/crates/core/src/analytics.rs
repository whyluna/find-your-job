//! 统计与决策视图。与写入/状态机分离，避免主服务模块继续膨胀。

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::entities::ts;
use crate::error::Result;
use crate::services::Services;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountRow {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeFunnelRow {
    pub resume_name: String,
    pub total: i64,
    pub interviewed: i64,
    pub offered: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentApplication {
    pub id: String,
    pub company_name: String,
    pub position_title: String,
    pub status: String,
    pub last_activity_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsDto {
    pub status_counts: Vec<CountRow>,
    pub stage_reached_counts: Vec<CountRow>,
    pub channel_counts: Vec<CountRow>,
    pub batch_counts: Vec<CountRow>,
    pub daily_applied: Vec<CountRow>,
    pub silent: Vec<SilentApplication>,
    pub resume_funnel: Vec<ResumeFunnelRow>,
}

impl Services {
    pub async fn get_stats(&self) -> Result<StatsDto> {
        let group = |col: &str| {
            format!(
                "SELECT {col} AS key, COUNT(*) AS count FROM application \
                 WHERE is_archived = 0 GROUP BY {col} ORDER BY count DESC"
            )
        };
        let to_rows = |rows: Vec<SqliteRow>| -> Vec<CountRow> {
            rows.iter()
                .map(|row| CountRow {
                    key: row.try_get("key").unwrap_or_default(),
                    count: row.try_get("count").unwrap_or(0),
                })
                .collect()
        };
        let status_counts = to_rows(sqlx::query(&group("status")).fetch_all(&self.pool).await?);
        let channel_counts = to_rows(sqlx::query(&group("channel")).fetch_all(&self.pool).await?);
        let batch_counts = to_rows(sqlx::query(&group("batch")).fetch_all(&self.pool).await?);

        // 到达后续阶段时也视为已到达前序阶段，保证漏斗单调且支持跳过测评/笔试。
        let stage_reached_counts = to_rows(
            sqlx::query(
                "SELECT 'APPLIED' AS key, COUNT(*) AS count FROM application a WHERE a.is_archived = 0 AND (\
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type != 'NOTE') OR \
                    EXISTS(SELECT 1 FROM interview iv WHERE iv.application_id = a.id)) \
                 UNION ALL SELECT 'ASSESSMENT', COUNT(*) FROM application a WHERE a.is_archived = 0 AND (\
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type IN \
                      ('ASSESSMENT_INVITED','ASSESSMENT_DONE','ASSESSMENT_FAILED','WRITTEN_INVITED','WRITTEN_DONE','WRITTEN_FAILED',\
                       'OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED')) OR \
                    EXISTS(SELECT 1 FROM interview iv WHERE iv.application_id = a.id)) \
                 UNION ALL SELECT 'WRITTEN', COUNT(*) FROM application a WHERE a.is_archived = 0 AND (\
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type IN \
                      ('WRITTEN_INVITED','WRITTEN_DONE','WRITTEN_FAILED','OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED')) OR \
                    EXISTS(SELECT 1 FROM interview iv WHERE iv.application_id = a.id)) \
                 UNION ALL SELECT 'INTERVIEWING', COUNT(*) FROM application a WHERE a.is_archived = 0 AND (\
                    EXISTS(SELECT 1 FROM interview iv WHERE iv.application_id = a.id) OR \
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type IN \
                      ('OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED'))) \
                 UNION ALL SELECT 'OC', COUNT(*) FROM application a WHERE a.is_archived = 0 AND \
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type IN \
                      ('OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED')) \
                 UNION ALL SELECT 'OFFER', COUNT(*) FROM application a WHERE a.is_archived = 0 AND \
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type IN \
                      ('OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED')) \
                 UNION ALL SELECT 'SIGNED', COUNT(*) FROM application a WHERE a.is_archived = 0 AND \
                    EXISTS(SELECT 1 FROM application_event e WHERE e.application_id = a.id AND e.type = 'SIGNED')",
            )
            .fetch_all(&self.pool)
            .await?,
        );

        let daily_rows = sqlx::query(
            "SELECT strftime('%Y-%m-%d', applied_date, 'localtime') AS key, COUNT(*) AS count \
             FROM application WHERE applied_date IS NOT NULL AND is_archived = 0 \
             GROUP BY key ORDER BY key",
        )
        .fetch_all(&self.pool)
        .await?;
        let daily_applied = to_rows(daily_rows);

        let silent_rows = sqlx::query(
            "SELECT a.id, c.name AS company_name, a.position_title, a.status, \
             COALESCE(\
               (SELECT MAX(activity_at) FROM (\
                  SELECT e.occurred_at AS activity_at FROM application_event e WHERE e.application_id = a.id \
                  UNION ALL \
                  SELECT COALESCE(iv.scheduled_at, iv.created_at) FROM interview iv WHERE iv.application_id = a.id\
               )), a.applied_date, a.created_at\
             ) AS last_activity_at \
             FROM application a JOIN company c ON c.id = a.company_id \
             WHERE a.is_archived = 0 AND a.status NOT IN ('REJECTED','WITHDRAWN','SIGNED') \
             AND COALESCE(\
               (SELECT MAX(activity_at) FROM (\
                  SELECT e.occurred_at AS activity_at FROM application_event e WHERE e.application_id = a.id \
                  UNION ALL \
                  SELECT COALESCE(iv.scheduled_at, iv.created_at) FROM interview iv WHERE iv.application_id = a.id\
               )), a.applied_date, a.created_at\
             ) <= ? ORDER BY last_activity_at ASC LIMIT 50",
        )
        .bind(ts(&(Utc::now() - chrono::Duration::days(14))))
        .fetch_all(&self.pool)
        .await?;
        let silent = silent_rows
            .iter()
            .map(|row| SilentApplication {
                id: row.try_get("id").unwrap_or_default(),
                company_name: row.try_get("company_name").unwrap_or_default(),
                position_title: row.try_get("position_title").unwrap_or_default(),
                status: row.try_get("status").unwrap_or_default(),
                last_activity_at: row.try_get("last_activity_at").unwrap_or_default(),
            })
            .collect();

        let funnel_rows = sqlx::query(
            "SELECT rv.name AS key, COUNT(a.id) AS count, \
             SUM(CASE WHEN a.id IS NOT NULL AND (\
                 EXISTS (SELECT 1 FROM interview iv WHERE iv.application_id = a.id) OR \
                 EXISTS (SELECT 1 FROM application_event e WHERE e.application_id = a.id \
                         AND e.type IN ('OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED'))\
             ) THEN 1 ELSE 0 END) AS interviewed, \
             SUM(CASE WHEN a.id IS NOT NULL AND \
                 EXISTS (SELECT 1 FROM application_event e WHERE e.application_id = a.id \
                         AND e.type IN ('OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED'))\
             THEN 1 ELSE 0 END) AS offered \
             FROM resume_version rv LEFT JOIN application a \
               ON a.resume_version_id = rv.id AND a.is_archived = 0 \
             GROUP BY rv.id ORDER BY rv.created_at",
        )
        .fetch_all(&self.pool)
        .await?;
        let resume_funnel = funnel_rows
            .iter()
            .map(|row| ResumeFunnelRow {
                resume_name: row.try_get("key").unwrap_or_default(),
                total: row.try_get("count").unwrap_or(0),
                interviewed: row.try_get("interviewed").unwrap_or(0),
                offered: row.try_get("offered").unwrap_or(0),
            })
            .collect();

        Ok(StatsDto {
            status_counts,
            stage_reached_counts,
            channel_counts,
            batch_counts,
            daily_applied,
            silent,
            resume_funnel,
        })
    }
}
