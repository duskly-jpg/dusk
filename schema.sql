-- Dusk v2 · schema（Cloudflare D1 / SQLite）
-- 设计要点：
--   1. 租约状态机：入住/退房=租约生命周期，房间状态由活跃租约推导
--   2. 流水记账：ledger 单笔收支（v1 为按月聚合），报表直查流水
--   3. 收租周期按天数（cycle_days），逾期罚金由 grace_days + penalty_daily 即时计算
--   4. 账单发票化：kind 拆分（rent/utility/penalty/deposit），due_on 应缴日
--   5. 水电计费周期显式创建，settle 结算出费用账单

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL DEFAULT '',           -- PBKDF2-SHA256(100k) hex
  salt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  address TEXT DEFAULT '',
  district TEXT DEFAULT '',                    -- 区位标签（报表维度）
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL DEFAULT '',               -- 房号
  floor INTEGER NOT NULL DEFAULT 0,
  area REAL NOT NULL DEFAULT 0,                -- 面积㎡
  status TEXT NOT NULL DEFAULT 'vacant',       -- vacant|occupied|reserved
  rent INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  cycle_days INTEGER NOT NULL DEFAULT 30,      -- 收租周期（天）
  grace_days INTEGER NOT NULL DEFAULT 3,       -- 逾期宽限（天）
  penalty_daily INTEGER NOT NULL DEFAULT 0,    -- 逾期日罚金
  power_rate REAL NOT NULL DEFAULT 0,
  water_rate REAL NOT NULL DEFAULT 0,
  furnishing TEXT DEFAULT '',                  -- 设施清单
  tenant_id INTEGER,                           -- 在住租客（活跃租约推导维护）
  lease_id INTEGER,                            -- 当前租约
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  gender TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  hometown TEXT DEFAULT '',
  employer TEXT DEFAULT '',
  emergency_contact TEXT DEFAULT '',           -- 紧急联系人
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 租约：入住=签租约，退房=终止租约
CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 0,
  start_on TEXT NOT NULL,
  end_on TEXT NOT NULL,
  rent INTEGER NOT NULL DEFAULT 0,             -- 签约月租
  deposit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',       -- active|ended
  ended_on TEXT,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 账单（发票式）
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER DEFAULT 0,
  lease_id INTEGER DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'rent',           -- rent|utility|penalty|deposit
  period_start TEXT,
  period_end TEXT,
  rent_part REAL NOT NULL DEFAULT 0,
  power_usage REAL NOT NULL DEFAULT 0, power_part REAL NOT NULL DEFAULT 0,
  water_usage REAL NOT NULL DEFAULT 0, water_part REAL NOT NULL DEFAULT 0,
  extra_part REAL NOT NULL DEFAULT 0,          -- 罚金/杂费
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending|paid|void
  issued_on TEXT NOT NULL DEFAULT (date('now')),
  due_on TEXT,                                 -- 应缴日
  paid_on TEXT,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other',      -- repair|labor|supply|agency|other
  amount REAL NOT NULL DEFAULT 0,
  recur TEXT NOT NULL DEFAULT 'none',          -- none|monthly
  occurred_on TEXT NOT NULL DEFAULT (date('now')),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL DEFAULT 0,
  utility TEXT NOT NULL DEFAULT 'power',       -- power|water
  label TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meter_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_id INTEGER NOT NULL DEFAULT 0,
  start_on TEXT NOT NULL,
  end_on TEXT NOT NULL,
  master_usage REAL NOT NULL DEFAULT 0,
  master_cost REAL NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  settled_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meter_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL DEFAULT 0,
  unit_id INTEGER NOT NULL DEFAULT 0,
  utility TEXT NOT NULL DEFAULT '',
  usage REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  read_on TEXT NOT NULL DEFAULT (date('now'))
);

-- 收支流水：单笔入账，报表直查
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL,                     -- income|expense
  source TEXT NOT NULL DEFAULT '',             -- invoice|expense|meter
  source_id INTEGER DEFAULT 0,
  category TEXT DEFAULT '',                    -- rent|utility|penalty|deposit|repair...
  amount REAL NOT NULL DEFAULT 0,
  booked_on TEXT NOT NULL DEFAULT (date('now')),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_units_building ON units(building_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, unit_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(booked_on);
