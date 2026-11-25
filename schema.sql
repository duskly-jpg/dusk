-- rent8 · D1 schema —— 自 rent82 (gitee.com/MarcoMaHH/rent82, Apache-2.0) MySQL 方言忠实移植
-- 映射：AUTO_INCREMENT→AUTOINCREMENT / float,double→REAL / varchar,char→TEXT / timestamp→TEXT(ISO)
-- 原表前缀 rent_ 略去（D1 单库无冲突）

CREATE TABLE IF NOT EXISTS admin_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_role_id INTEGER NOT NULL DEFAULT 0,       -- 角色id
  username TEXT NOT NULL UNIQUE,                  -- 用户名
  password TEXT NOT NULL DEFAULT '',              -- PBKDF2-SHA256(100k) hex
  salt TEXT NOT NULL DEFAULT '',                  -- hex 32B
  openid TEXT DEFAULT '',                         -- 微信小程序openID
  expiration_date TEXT, login_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  update_time TEXT
);
CREATE TABLE IF NOT EXISTS admin_role (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'Y',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS admin_menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
  icon TEXT DEFAULT '', controller TEXT DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS admin_permission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_role_id INTEGER NOT NULL DEFAULT 0,
  controller TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '*',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS admin_parameter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL, note TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS admin_subscribe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_id TEXT NOT NULL, thing1 TEXT NOT NULL,     -- 房产名称
  time2 TEXT NOT NULL, amount4 INTEGER NOT NULL,   -- 收租日期/应收租金
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS bill_sum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL DEFAULT 0, house_property_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,                              -- A房租账单/B逾期/C退房
  amount REAL NOT NULL DEFAULT 0,
  accounting_date TEXT NOT NULL, annual TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS house_fee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL DEFAULT 0,
  column_id TEXT NOT NULL, column_name TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS house_property (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '', name_show TEXT NOT NULL DEFAULT '',
  address TEXT, landlord TEXT, phone TEXT, id_card TEXT,
  is_default TEXT NOT NULL DEFAULT 'N',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS house_number (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0,
  tenant_message_id INTEGER,                       -- 租客id
  house_receipt_id INTEGER,                        -- 当前收据单号
  name TEXT NOT NULL DEFAULT '',
  rental INTEGER NOT NULL DEFAULT 0, deposit INTEGER NOT NULL DEFAULT 0,
  daily_rent INTEGER NOT NULL DEFAULT 0,           -- 逾期日租金
  checkin_date TEXT, payment_date TEXT,
  cycle INTEGER NOT NULL DEFAULT 1, cycle_type TEXT NOT NULL DEFAULT 'month',
  calculate_date TEXT NOT NULL, lease INTEGER NOT NULL DEFAULT 0,  -- 计算日期/期数
  water_price REAL NOT NULL DEFAULT 0, electricity_price REAL NOT NULL DEFAULT 0,
  fees1 INTEGER NOT NULL DEFAULT 0, fees2 INTEGER NOT NULL DEFAULT 0,
  fees3 INTEGER NOT NULL DEFAULT 0, fees4 REAL NOT NULL DEFAULT 0,
  equipment TEXT, delete_time TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS house_receipt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_type TEXT NOT NULL DEFAULT '',              -- A房租/B逾期/C退房
  house_property_id INTEGER NOT NULL DEFAULT 0, house_number_id INTEGER NOT NULL DEFAULT 0,
  tenant_message_id INTEGER NOT NULL DEFAULT 0,
  start_time TEXT, end_time TEXT, meter_reading_time TEXT,
  electricity_meter_this_month INTEGER, electricity_meter_last_month INTEGER,
  electricity_consumption INTEGER, electricity REAL NOT NULL DEFAULT 0,
  water_meter_this_month INTEGER, water_meter_last_month INTEGER,
  water_consumption INTEGER, water REAL NOT NULL DEFAULT 0,
  rental INTEGER NOT NULL DEFAULT 0, deposit INTEGER NOT NULL DEFAULT 0,
  fees1 INTEGER NOT NULL DEFAULT 0, fees2 REAL NOT NULL DEFAULT 0,
  fees3 REAL NOT NULL DEFAULT 0, fees4 REAL NOT NULL DEFAULT 0,
  total_money REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '', accounting_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS house_other (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT '', total_money REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '', accout_mark TEXT NOT NULL DEFAULT 'N',
  circulate_mark TEXT NOT NULL DEFAULT 'N', accounting_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS tenant_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0, house_number_id INTEGER NOT NULL DEFAULT 0,
  pid INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '', sex TEXT NOT NULL DEFAULT '',
  checkout_mark TEXT NOT NULL DEFAULT 'N',
  phone TEXT DEFAULT '', id_card_number TEXT DEFAULT '', native_place TEXT DEFAULT '',
  work_units TEXT DEFAULT '', note TEXT DEFAULT '',
  checkin_date TEXT, leave_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS tenant_contract (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0, house_number_id INTEGER NOT NULL DEFAULT 0,
  tenant_message_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'Y', start_date TEXT, end_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS tenant_maintain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0, house_number_id INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'N',                -- Y已解决/N未解决
  description TEXT DEFAULT '',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS photo_tenant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0, tenant_message_id INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS photo_contract (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_property_id INTEGER NOT NULL DEFAULT 0, tenant_message_id INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS we_meter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
  house_property_id INTEGER NOT NULL DEFAULT 0, house_number_id TEXT NOT NULL DEFAULT '',
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS we_bill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_id INTEGER NOT NULL DEFAULT 0, house_property_id INTEGER NOT NULL DEFAULT 0,
  accounting_date TEXT, start_month TEXT, end_month TEXT,
  master_dosage INTEGER NOT NULL DEFAULT 0, master_sum REAL NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
CREATE TABLE IF NOT EXISTS we_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_id INTEGER NOT NULL DEFAULT 0, house_property_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,                              -- B电费/C水费
  amount REAL NOT NULL DEFAULT 0, dosage REAL NOT NULL DEFAULT 0, calculate_date TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now','localtime')), update_time TEXT
);
