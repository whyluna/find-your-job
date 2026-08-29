-- 手动排序：投递表格支持拖拽调整顺序
ALTER TABLE application ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1;

-- 回填：按创建时间倒序（最新排最前，与既有列表顺序一致）
UPDATE application SET sort_order = (
  SELECT COUNT(*) FROM application a2 WHERE a2.rowid >= application.rowid
);

CREATE INDEX IF NOT EXISTS idx_application_sort ON application(sort_order);
