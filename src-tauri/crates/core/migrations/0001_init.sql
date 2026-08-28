-- FindYourJob 初始 schema（设计文档 §3.2 / §3.6）
-- 时间统一 ISO-8601 UTC 文本；枚举列用 CHECK 兜底（应用层 Rust enum + 前端 zod 双重校验）
-- 自定义字典值约定前缀 custom:%（渠道/批次/事件类型可扩展）

CREATE TABLE IF NOT EXISTS company (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  aliases     TEXT NOT NULL DEFAULT '[]',
  industry    TEXT,
  nature      TEXT,
  website     TEXT,
  careers_url TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS resume_version (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  target_role TEXT,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER,
  notes       TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contact (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  wechat     TEXT,
  phone      TEXT,
  notes      TEXT,
  company_id TEXT REFERENCES company(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS application (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
  position_title   TEXT NOT NULL,
  department       TEXT,
  work_location    TEXT,
  channel          TEXT NOT NULL DEFAULT 'COMPANY_SITE'
                   CHECK (channel IN ('COMPANY_SITE','BOSS','NOWCODER','SHIXISENG','LIEPIN','REFERRAL','EMAIL','JOBFAIR','OTHER') OR channel LIKE 'custom:%'),
  batch            TEXT NOT NULL DEFAULT 'FORMAL'
                   CHECK (batch IN ('EARLY','FORMAL','SPRING','SUPPLEMENT','DAILY_INTERN','VACATION_INTERN','OTHER') OR batch LIKE 'custom:%'),
  priority         TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  status           TEXT NOT NULL DEFAULT 'SAVED'
                   CHECK (status IN ('SAVED','APPLIED','ASSESSMENT','WRITTEN','INTERVIEWING','OC','INTENT','OFFER','SIGNED','REJECTED','WITHDRAWN')),
  applied_date     TEXT,
  job_url          TEXT,
  jd_text          TEXT,
  jd_snapshot_at   TEXT,
  salary_range     TEXT,
  tags             TEXT NOT NULL DEFAULT '[]',
  resume_version_id TEXT REFERENCES resume_version(id) ON DELETE SET NULL,
  referred_by_id   TEXT REFERENCES contact(id) ON DELETE SET NULL,
  notes            TEXT,
  is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_application_status      ON application(status);
CREATE INDEX IF NOT EXISTS idx_application_company     ON application(company_id);
CREATE INDEX IF NOT EXISTS idx_application_applied     ON application(applied_date);

CREATE TABLE IF NOT EXISTS application_event (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  type           TEXT NOT NULL
                 CHECK (type IN ('APPLIED','ASSESSMENT_INVITED','ASSESSMENT_DONE','ASSESSMENT_FAILED',
                                 'WRITTEN_INVITED','WRITTEN_DONE','WRITTEN_FAILED',
                                 'RESUME_PASS','RESUME_FAIL','HR_CONTACT',
                                 'OC','INTENT_LETTER','OFFER','DUAL_AGREEMENT','TRIPLICATE','SIGNED',
                                 'REJECTED','WITHDRAWN','NOTE') OR type LIKE 'custom:%'),
  occurred_at    TEXT NOT NULL,
  deadline       TEXT,
  result         TEXT CHECK (result IS NULL OR result IN ('PENDING','PASS','FAIL','UNKNOWN')),
  note           TEXT,
  source         TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','EXTENSION','EMAIL')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_event_app_time ON application_event(application_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_event_deadline ON application_event(deadline);

CREATE TABLE IF NOT EXISTS interview (
  id                TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  round             INTEGER NOT NULL CHECK (round >= 1),
  round_label       TEXT,
  format            TEXT CHECK (format IS NULL OR format IN ('PHONE','VIDEO','ONSITE','GROUP','AI')),
  scheduled_at      TEXT,
  duration_min      INTEGER,
  location_or_link  TEXT,
  interviewer_note  TEXT,
  status            TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  outcome           TEXT NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING','PASS','FAIL','UNKNOWN')),
  self_rating       INTEGER CHECK (self_rating IS NULL OR (self_rating BETWEEN 1 AND 5)),
  overall_reflection TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_app       ON interview(application_id);
CREATE INDEX IF NOT EXISTS idx_interview_scheduled ON interview(scheduled_at);

CREATE TABLE IF NOT EXISTS interview_question (
  id          TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL DEFAULT 0,
  question    TEXT NOT NULL,
  my_answer   TEXT,
  quality     TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (quality IN ('GOOD','OK','BAD','UNKNOWN')),
  reflection  TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_question_interview ON interview_question(interview_id);

CREATE TABLE IF NOT EXISTS attachment (
  id          TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('APPLICATION','INTERVIEW')),
  parent_id   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  mime_type   TEXT,
  size        INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attachment_parent ON attachment(parent_type, parent_id);

CREATE TABLE IF NOT EXISTS reminder (
  id             TEXT PRIMARY KEY,
  application_id TEXT REFERENCES application(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  due_at         TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'CUSTOM',
  is_done        INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reminder_due ON reminder(due_at, is_done);

CREATE TABLE IF NOT EXISTS email_account (
  id             TEXT PRIMARY KEY,
  host           TEXT NOT NULL,
  port           INTEGER NOT NULL DEFAULT 993,
  secure         INTEGER NOT NULL DEFAULT 1 CHECK (secure IN (0, 1)),
  username       TEXT NOT NULL,
  credential_ref TEXT,
  folder         TEXT NOT NULL DEFAULT 'INBOX',
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_sync_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS email_parse_log (
  id                     TEXT PRIMARY KEY,
  email_account_id       TEXT NOT NULL REFERENCES email_account(id) ON DELETE CASCADE,
  message_id             TEXT NOT NULL UNIQUE,
  received_at            TEXT NOT NULL,
  from_address           TEXT NOT NULL,
  from_name              TEXT,
  subject                TEXT,
  snippet                TEXT,
  raw_path               TEXT,
  status                 TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IMPORTED','IGNORED','UNMATCHED')),
  suggested_event_type   TEXT,
  suggested_deadline     TEXT,
  suggested_occurred_at  TEXT,
  matched_application_id TEXT REFERENCES application(id) ON DELETE SET NULL,
  match_reason           TEXT,
  note                   TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_parse_status ON email_parse_log(status);

CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 用户可编辑字典（§3.6）：系统预置 is_system=1 不可删但可隐藏/改名
CREATE TABLE IF NOT EXISTS dictionary (
  id        TEXT PRIMARY KEY,
  category  TEXT NOT NULL CHECK (category IN ('CHANNEL','BATCH','ROUND_LABEL','CUSTOM_EVENT_TYPE')),
  key       TEXT NOT NULL,
  label     TEXT NOT NULL,
  extra     TEXT NOT NULL DEFAULT '{}',
  sort      INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  UNIQUE (category, key)
);

-- 自定义事件类型：projection 映射到 §3.4 固定状态投影或 NO_CHANGE
CREATE TABLE IF NOT EXISTS custom_event_type (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  projection        TEXT NOT NULL CHECK (projection IN ('NO_CHANGE','APPLIED','ASSESSMENT','WRITTEN','INTERVIEWING','OC','INTENT','OFFER','SIGNED','REJECTED','WITHDRAWN')),
  deadline_required INTEGER NOT NULL DEFAULT 0 CHECK (deadline_required IN (0, 1)),
  result_required   INTEGER NOT NULL DEFAULT 0 CHECK (result_required IN (0, 1)),
  sort              INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------- 种子：渠道（9） ----------
INSERT OR IGNORE INTO dictionary (id, category, key, label, sort, is_active, is_system) VALUES
  ('seed-ch-company-site', 'CHANNEL', 'COMPANY_SITE', '官网网申',      1, 1, 1),
  ('seed-ch-boss',         'CHANNEL', 'BOSS',         'Boss直聘',      2, 1, 1),
  ('seed-ch-nowcoder',     'CHANNEL', 'NOWCODER',     '牛客',          3, 1, 1),
  ('seed-ch-shixiseng',    'CHANNEL', 'SHIXISENG',    '实习僧',        4, 1, 1),
  ('seed-ch-liepin',       'CHANNEL', 'LIEPIN',       '猎聘',          5, 1, 1),
  ('seed-ch-referral',     'CHANNEL', 'REFERRAL',     '内推',          6, 1, 1),
  ('seed-ch-email',        'CHANNEL', 'EMAIL',        '邮箱投递',      7, 1, 1),
  ('seed-ch-jobfair',      'CHANNEL', 'JOBFAIR',      '宣讲会/双选会', 8, 1, 1),
  ('seed-ch-other',        'CHANNEL', 'OTHER',        '其他',          9, 1, 1);

-- ---------- 种子：批次（7） ----------
INSERT OR IGNORE INTO dictionary (id, category, key, label, sort, is_active, is_system) VALUES
  ('seed-ba-early',    'BATCH', 'EARLY',          '提前批',     1, 1, 1),
  ('seed-ba-formal',   'BATCH', 'FORMAL',         '正式批',     2, 1, 1),
  ('seed-ba-spring',   'BATCH', 'SPRING',         '春招',       3, 1, 1),
  ('seed-ba-supplement','BATCH','SUPPLEMENT',     '补录',       4, 1, 1),
  ('seed-ba-daily',    'BATCH', 'DAILY_INTERN',   '日常实习',   5, 1, 1),
  ('seed-ba-vacation', 'BATCH', 'VACATION_INTERN','寒暑假实习', 6, 1, 1),
  ('seed-ba-other',    'BATCH', 'OTHER',          '其他',       7, 1, 1);

-- ---------- 种子：面试轮次标签（9） ----------
INSERT OR IGNORE INTO dictionary (id, category, key, label, sort, is_active, is_system) VALUES
  ('seed-rl-1', 'ROUND_LABEL', 'r1',     '一面',   1, 1, 1),
  ('seed-rl-2', 'ROUND_LABEL', 'r2',     '二面',   2, 1, 1),
  ('seed-rl-3', 'ROUND_LABEL', 'r3',     '三面',   3, 1, 1),
  ('seed-rl-hr','ROUND_LABEL', 'hr',     'HR面',   4, 1, 1),
  ('seed-rl-gr','ROUND_LABEL', 'group',  '群面',   5, 1, 1),
  ('seed-rl-cr','ROUND_LABEL', 'cross',  '交叉面', 6, 1, 1),
  ('seed-rl-fi','ROUND_LABEL', 'final',  '终面',   7, 1, 1),
  ('seed-rl-ph','ROUND_LABEL', 'phone',  '电话面', 8, 1, 1),
  ('seed-rl-ai','ROUND_LABEL', 'ai',     'AI面',   9, 1, 1);

-- ---------- 种子：设置 ----------
INSERT OR IGNORE INTO setting (key, value_json) VALUES
  ('onboarded', 'false'),
  ('scenario_template', '""'),
  ('board_columns', '["SAVED","APPLIED","ASSESSMENT","WRITTEN","INTERVIEWING","OC","INTENT","OFFER","SIGNED","REJECTED","WITHDRAWN"]');
