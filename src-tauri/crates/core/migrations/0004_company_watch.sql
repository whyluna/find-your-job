-- 公司资料独立于招聘季。收藏公司不会创建 application，也不会改变投递统计。
CREATE TABLE IF NOT EXISTS company_watch (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  season TEXT NOT NULL CHECK (season IN ('AUTUMN','SPRING','INTERNSHIP')),
  status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('UNKNOWN','NOT_OPEN','OPEN','CLOSED')),
  recruitment_url TEXT,
  target_role TEXT,
  target_location TEXT,
  notes TEXT,
  interval_days INTEGER CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 365),
  next_check_at TEXT,
  last_checked_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, year, season)
);
CREATE INDEX IF NOT EXISTS idx_company_watch_due ON company_watch(paused, status, next_check_at);

CREATE TABLE IF NOT EXISTS company_watch_check (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES company_watch(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('FOLLOWED','CHECK','SNOOZE','PAUSE','RESUME','EDIT')),
  status TEXT NOT NULL CHECK (status IN ('UNKNOWN','NOT_OPEN','OPEN','CLOSED')),
  recorded_at TEXT NOT NULL,
  next_check_at TEXT,
  note TEXT,
  evidence_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_watch_check_time ON company_watch_check(watch_id, recorded_at);
