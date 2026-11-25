// Dusk v2 · Hono + Cloudflare Workers + D1（schema 设计要点见 schema.sql 注释）
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { pbkdf2Hash, randomHex, signToken, verifyToken } from './lib/auth';

type Bindings = { DB: D1Database; AUTH_SECRET?: string };
const app = new Hono<{ Bindings: Bindings }>();

const OK = (c: any, data: any = null, msg = 'success') => c.json({ code: 0, msg, data });
const FAIL = (c: any, msg: string, code = 1) => c.json({ code, msg, data: null }, 200);
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const today = () => new Date().toISOString().slice(0, 10);
const SECRET = (c: any) => c.env.AUTH_SECRET || 'change-me-in-production';
const COOKIE = 'dusk_session';
const n2 = (x: number) => Math.round(x * 100) / 100;

app.use('/api/*', async (c: any, next: any) => {
  const open = ['/api/auth/login', '/api/auth/setup', '/api/auth/need-setup'];
  if (open.includes(c.req.path)) return next();
  const t = getCookie(c, COOKIE);
  const id = t ? await verifyToken(SECRET(c), t) : null;
  if (!id) return FAIL(c, '未登录', 401);
  c.set('uid', id);
  return next();
});

// ---------- 鉴权 ----------
app.post('/api/auth/setup', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<any>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '管理员已存在，禁止重复初始化');
  const { username, password } = await c.req.json<any>();
  if (!username || !password || password.length < 8) return FAIL(c, '用户名必填，密码≥8位');
  const salt = randomHex();
  const r = await c.env.DB.prepare('INSERT INTO users (username,password,salt) VALUES (?,?,?)')
    .bind(username, await pbkdf2Hash(password, salt), salt).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.get('/api/auth/need-setup', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<any>();
  return OK(c, { need_setup: (n?.n ?? 0) === 0 });
});
app.post('/api/auth/login', async (c: any) => {
  const { username, password } = await c.req.json<any>();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username || '').first<any>();
  if (!u || (await pbkdf2Hash(password || '', u.salt)) !== u.password) return FAIL(c, '账号或密码错误');
  const token = await signToken(SECRET(c), u.id);
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 7 * 86400, path: '/' });
  return OK(c, { uid: u.id, username: u.username });
});
app.post('/api/auth/logout', (c: any) => { setCookie(c, COOKIE, '', { maxAge: 0, path: '/' }); return OK(c); });
app.get('/api/auth/me', async (c: any) => {
  const u = await c.env.DB.prepare('SELECT id,username FROM users WHERE id=?').bind(c.get('uid')).first<any>();
  return OK(c, u);
});
app.post('/api/auth/password', async (c: any) => {
  const { old_password, new_password } = await c.req.json<any>();
  if (!new_password || new_password.length < 8) return FAIL(c, '新密码≥8位');
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(c.get('uid')).first<any>();
  if ((await pbkdf2Hash(old_password || '', u.salt)) !== u.password) return FAIL(c, '原密码错误');
  const salt = randomHex();
  await c.env.DB.prepare('UPDATE users SET password=?,salt=? WHERE id=?').bind(await pbkdf2Hash(new_password, salt), salt, u.id).run();
  return OK(c);
});

// ---------- 楼栋 ----------
app.get('/api/buildings', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM units u WHERE u.building_id=b.id) AS unit_total,
      (SELECT COUNT(*) FROM units u WHERE u.building_id=b.id AND u.status='occupied') AS unit_occupied
    FROM buildings b ORDER BY b.id`).all();
  return OK(c, rows.results);
});
app.post('/api/buildings', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.title) return FAIL(c, '楼栋名必填');
  const r = await c.env.DB.prepare('INSERT INTO buildings (title,address,district,note) VALUES (?,?,?,?)')
    .bind(b.title, b.address || '', b.district || '', b.note || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/buildings/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE buildings SET title=?,address=?,district=?,note=? WHERE id=?')
    .bind(b.title, b.address || '', b.district || '', b.note || '', c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/buildings/:id', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM units WHERE building_id=?').bind(c.req.param('id')).first<any>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '楼栋下仍有房间，禁止删除');
  await c.env.DB.prepare('DELETE FROM buildings WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 房间 ----------
app.get('/api/units', async (c: any) => {
  const bid = c.req.query('building_id') || '';
  const rows = await c.env.DB.prepare(`
    SELECT u.*, t.name AS tenant_name, t.phone AS tenant_phone,
      l.end_on AS lease_end, CAST(julianday(l.end_on)-julianday('now') AS INTEGER) AS days_left
    FROM units u LEFT JOIN tenants t ON t.id=u.tenant_id
      LEFT JOIN leases l ON l.id=u.lease_id AND l.status='active'
    ${bid ? 'WHERE u.building_id=?' : ''} ORDER BY u.building_id, u.code`).bind(...(bid ? [bid] : [])).all();
  return OK(c, rows.results);
});
app.post('/api/units', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.building_id || !b.code) return FAIL(c, '楼栋与房号必填');
  const r = await c.env.DB.prepare(`INSERT INTO units
    (building_id,code,floor,area,status,rent,deposit,cycle_days,grace_days,penalty_daily,power_rate,water_rate,furnishing,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    b.building_id, b.code, b.floor || 0, b.area || 0, b.status || 'vacant', b.rent || 0, b.deposit || 0,
    b.cycle_days || 30, b.grace_days || 3, b.penalty_daily || 0, b.power_rate || 0, b.water_rate || 0,
    b.furnishing || '', b.note || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/units/:id', async (c: any) => {
  const b = await c.req.json<any>();
  const cur = await c.env.DB.prepare('SELECT status FROM units WHERE id=?').bind(c.req.param('id')).first<any>();
  if (cur?.status === 'occupied' && b.status === 'vacant') return FAIL(c, '在住房间须先退房再置空');
  await c.env.DB.prepare(`UPDATE units SET code=?,floor=?,area=?,status=?,rent=?,deposit=?,cycle_days=?,grace_days=?,
    penalty_daily=?,power_rate=?,water_rate=?,furnishing=?,note=?,updated_at=datetime('now','localtime') WHERE id=?`).bind(
    b.code, b.floor || 0, b.area || 0, b.status || 'vacant', b.rent || 0, b.deposit || 0, b.cycle_days || 30,
    b.grace_days || 3, b.penalty_daily || 0, b.power_rate || 0, b.water_rate || 0, b.furnishing || '', b.note || '',
    c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/units/:id', async (c: any) => {
  const u = await c.env.DB.prepare('SELECT status FROM units WHERE id=?').bind(c.req.param('id')).first<any>();
  if (u?.status === 'occupied') return FAIL(c, '在住房间禁止删除');
  await c.env.DB.prepare('DELETE FROM units WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 租客 ----------
app.get('/api/tenants', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT t.*, u.code AS unit_code, u.id AS unit_id, b.title AS building_title, l.end_on AS lease_end
    FROM tenants t
    LEFT JOIN units u ON u.tenant_id=t.id AND u.status='occupied'
    LEFT JOIN buildings b ON b.id=u.building_id
    LEFT JOIN leases l ON l.tenant_id=t.id AND l.status='active'
    ORDER BY t.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/tenants', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.name) return FAIL(c, '姓名必填');
  const r = await c.env.DB.prepare(`INSERT INTO tenants (name,gender,phone,id_number,hometown,employer,emergency_contact,note)
    VALUES (?,?,?,?,?,?,?,?)`).bind(b.name, b.gender || '', b.phone || '', b.id_number || '', b.hometown || '',
    b.employer || '', b.emergency_contact || '', b.note || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/tenants/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare(`UPDATE tenants SET name=?,gender=?,phone=?,id_number=?,hometown=?,employer=?,emergency_contact=?,note=? WHERE id=?`)
    .bind(b.name, b.gender || '', b.phone || '', b.id_number || '', b.hometown || '', b.employer || '', b.emergency_contact || '', b.note || '', c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/tenants/:id', async (c: any) => {
  const n = await c.env.DB.prepare(`SELECT COUNT(*) n FROM units WHERE tenant_id=? AND status='occupied'`).bind(c.req.param('id')).first<any>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '租客在住，请先办理退房');
  await c.env.DB.prepare('DELETE FROM tenants WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 租约（入住 = 建租约；退房 = 终止租约） ----------
app.get('/api/leases', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT l.*, t.name AS tenant_name, u.code AS unit_code, b.title AS building_title,
      CAST(julianday(l.end_on)-julianday('now') AS INTEGER) AS days_left
    FROM leases l LEFT JOIN tenants t ON t.id=l.tenant_id
      LEFT JOIN units u ON u.id=l.unit_id LEFT JOIN buildings b ON b.id=u.building_id
    ORDER BY l.status, l.end_on`).all();
  return OK(c, rows.results);
});
app.post('/api/leases', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.unit_id || !b.tenant_id || !b.start_on || !b.end_on) return FAIL(c, '房间/租客/起止日期必填');
  const u = await c.env.DB.prepare('SELECT * FROM units WHERE id=?').bind(b.unit_id).first<any>();
  if (!u) return FAIL(c, '房间不存在');
  if (u.status === 'occupied') return FAIL(c, '房间在住，无法重复入住');
  const d = now();
  const r = await c.env.DB.prepare(`INSERT INTO leases (unit_id,tenant_id,start_on,end_on,rent,deposit,status,note)
    VALUES (?,?,?,?,?,?,'active',?)`).bind(b.unit_id, b.tenant_id, b.start_on, b.end_on, b.rent ?? u.rent, b.deposit ?? u.deposit, b.note || '').run();
  await c.env.DB.prepare("UPDATE units SET status='occupied',tenant_id=?,lease_id=?,updated_at=? WHERE id=?")
    .bind(b.tenant_id, r.meta.last_row_id, d, b.unit_id).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.post('/api/leases/:id/end', async (c: any) => {
  const l = await c.env.DB.prepare('SELECT * FROM leases WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!l || l.status !== 'active') return FAIL(c, '租约不存在或已结束');
  const d = today();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE leases SET status='ended',ended_on=? WHERE id=?").bind(d, l.id),
    c.env.DB.prepare("UPDATE units SET status='vacant',tenant_id=NULL,lease_id=NULL,updated_at=? WHERE id=?").bind(now(), l.unit_id),
  ]);
  return OK(c);
});

// ---------- 账单 ----------
// 列表：含逾期天数与应计罚金（grace_days+penalty_daily 引擎）
app.get('/api/invoices', async (c: any) => {
  const status = c.req.query('status') === 'paid' ? 'paid' : 'pending';
  const rows = await c.env.DB.prepare(`
    SELECT i.*, u.code AS unit_code, u.penalty_daily AS unit_penalty, u.grace_days AS unit_grace,
      t.name AS tenant_name, b.title AS building_title
    FROM invoices i LEFT JOIN units u ON u.id=i.unit_id
      LEFT JOIN tenants t ON t.id=i.tenant_id LEFT JOIN buildings b ON b.id=u.building_id
    WHERE i.status=? ORDER BY i.due_on, i.id DESC`).bind(status).all();
  const list = rows.results.map((x: any) => {
    const overdue = x.status === 'pending' && x.due_on
      ? Math.max(0, Math.floor((Date.now() - new Date(x.due_on + 'T00:00:00Z').getTime()) / 86400000) - (x.unit_grace || 0)) : 0;
    return { ...x, overdue_days: overdue, penalty_due: n2(overdue * (x.unit_penalty || 0)) };
  });
  const sum = list.reduce((s: number, x: any) => s + x.amount, 0);
  return OK(c, { list, sum: n2(sum), overdue_count: list.filter((x: any) => x.overdue_days > 0).length });
});
// 出账：租约期租金账单（按周期天数）
app.post('/api/invoices', async (c: any) => {
  const b = await c.req.json<any>();
  const u = await c.env.DB.prepare('SELECT * FROM units WHERE id=?').bind(b.unit_id).first<any>();
  if (!u) return FAIL(c, '房间不存在');
  if (u.status !== 'occupied' && (b.kind || 'rent') !== 'penalty') return FAIL(c, '仅罚金账单可开给空房');
  const periodStart = b.period_start || today();
  const periodEnd = b.period_end || new Date(Date.now() + (u.cycle_days || 30) * 86400000).toISOString().slice(0, 10);
  const rentPart = (b.kind || 'rent') === 'rent' ? (b.rent_part ?? u.rent) : 0;
  const amount = n2((b.amount ?? rentPart) || 0);
  const dueOn = b.due_on || periodEnd;
  const r = await c.env.DB.prepare(`INSERT INTO invoices
    (unit_id,tenant_id,lease_id,kind,period_start,period_end,rent_part,amount,status,issued_on,due_on,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(b.unit_id, u.tenant_id || 0, u.lease_id || 0, b.kind || 'rent', periodStart, periodEnd, rentPart, amount,
      'pending', today(), dueOn, b.note || '').run();
  return OK(c, { id: r.meta.last_row_id, amount });
});
// 到账：标记 + 流水入账
app.post('/api/invoices/:id/pay', async (c: any) => {
  const i = await c.env.DB.prepare(`SELECT i.*, u.building_id FROM invoices i
    JOIN units u ON u.id=i.unit_id WHERE i.id=?`).bind(c.req.param('id')).first<any>();
  if (!i) return FAIL(c, '账单不存在');
  if (i.status !== 'pending') return FAIL(c, '账单已结清或已作废');
  const d = today();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE invoices SET status='paid',paid_on=? WHERE id=?").bind(d, i.id),
    c.env.DB.prepare(`INSERT INTO ledger (building_id,direction,source,source_id,category,amount,booked_on,note)
      VALUES (?,?,?,?,?,?,?,'')`).bind(i.building_id || 0, 'income', 'invoice', i.id, i.kind, i.amount, d),
  ]);
  return OK(c);
});
// 逾期罚金账单（引擎即时计算）
app.post('/api/invoices/:id/penalty', async (c: any) => {
  const i = await c.env.DB.prepare(`SELECT i.*, u.penalty_daily, u.grace_days FROM invoices i
    LEFT JOIN units u ON u.id=i.unit_id WHERE i.id=?`).bind(c.req.param('id')).first<any>();
  if (!i || i.status !== 'pending') return FAIL(c, '仅未结清账单可计罚金');
  const overdue = Math.max(0, Math.floor((Date.now() - new Date(i.due_on + 'T00:00:00Z').getTime()) / 86400000) - (i.grace_days || 0));
  if (overdue <= 0) return FAIL(c, '未超出宽限期，无需罚金');
  const amount = n2(overdue * (i.penalty_daily || 0));
  const r = await c.env.DB.prepare(`INSERT INTO invoices (unit_id,tenant_id,lease_id,kind,period_start,period_end,extra_part,amount,status,issued_on,due_on,note)
    VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(
    i.unit_id, i.tenant_id, i.lease_id, 'penalty', i.due_on, today(), amount, amount, today(), today(),
    `${i.unit_code||''} 逾期${overdue}天×¥${i.penalty_daily}/天`).run();
  return OK(c, { id: r.meta.last_row_id, amount, overdue_days: overdue });
});
app.delete('/api/invoices/:id', async (c: any) => {
  const i = await c.env.DB.prepare('SELECT status FROM invoices WHERE id=?').bind(c.req.param('id')).first<any>();
  if (i?.status === 'paid') return FAIL(c, '已结清账单不可删除');
  await c.env.DB.prepare('DELETE FROM invoices WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 支出 ----------
app.get('/api/expenses', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT e.*, b.title AS building_title, l.id AS ledger_id FROM expenses e
    LEFT JOIN buildings b ON b.id=e.building_id
    LEFT JOIN ledger l ON l.source='expense' AND l.source_id=e.id
    ORDER BY e.occurred_on DESC, e.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/expenses', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.amount) return FAIL(c, '金额必填');
  const r = await c.env.DB.prepare(`INSERT INTO expenses (building_id,category,amount,recur,occurred_on,note)
    VALUES (?,?,?,?,?,?)`).bind(b.building_id || 0, b.category || 'other', b.amount, b.recur || 'none', b.occurred_on || today(), b.note || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.delete('/api/expenses/:id', async (c: any) => {
  const e = await c.env.DB.prepare('SELECT id FROM expenses WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!e) return FAIL(c, '记录不存在');
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM ledger WHERE source='expense' AND source_id=?").bind(e.id),
    c.env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(e.id),
  ]);
  return OK(c);
});
// 入账：写流水 + monthly 循环支出自动生成下期
app.post('/api/expenses/:id/book', async (c: any) => {
  const e = await c.env.DB.prepare('SELECT * FROM expenses WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!e) return FAIL(c, '记录不存在');
  const d = e.occurred_on || today();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO ledger (building_id,direction,source,source_id,category,amount,booked_on,note)
      VALUES (?,'expense','expense',?,?,?,?,?)`).bind(e.building_id, e.id, e.category, e.amount, d, e.note || ''),
  ];
  if (e.recur === 'monthly') {
    const next = new Date(d + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    stmts.push(c.env.DB.prepare(`INSERT INTO expenses (building_id,category,amount,recur,occurred_on,note)
      VALUES (?,?,?,'monthly',?,?)`).bind(e.building_id, e.category, e.amount, next.toISOString().slice(0, 10), e.note || ''));
  }
  await c.env.DB.batch(stmts);
  return OK(c);
});

// ---------- 水电 ----------
app.get('/api/meters', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT m.*, b.title AS building_title,
      (SELECT COUNT(*) FROM meter_periods p WHERE p.meter_id=m.id) AS period_count
    FROM meters m LEFT JOIN buildings b ON b.id=m.building_id ORDER BY m.id`).all();
  return OK(c, rows.results);
});
app.post('/api/meters', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.building_id || !b.label || !b.utility) return FAIL(c, '楼栋/名称/类型必填');
  const r = await c.env.DB.prepare('INSERT INTO meters (building_id,utility,label) VALUES (?,?,?)')
    .bind(b.building_id, b.utility === 'water' ? 'water' : 'power', b.label).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.delete('/api/meters/:id', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM meter_periods WHERE meter_id=?').bind(c.req.param('id')).first<any>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '总表下已有计费周期，禁止删除');
  await c.env.DB.prepare('DELETE FROM meters WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});
// 计费周期列表（含分摊合计与差额）
app.get('/api/periods', async (c: any) => {
  const utility = c.req.query('utility') === 'water' ? 'water' : 'power';
  const rows = await c.env.DB.prepare(`
    SELECT p.*, m.label AS meter_label, m.building_id, b.title AS building_title,
      (SELECT SUM(r.usage) FROM meter_readings r WHERE r.period_id=p.id) AS detail_usage,
      (SELECT SUM(r.cost) FROM meter_readings r WHERE r.period_id=p.id) AS detail_cost
    FROM meter_periods p LEFT JOIN meters m ON m.id=p.meter_id LEFT JOIN buildings b ON b.id=m.building_id
    WHERE m.utility=? ORDER BY p.id DESC`).bind(utility).all();
  return OK(c, { list: rows.results.map((x: any) => ({ ...x,
    diff_usage: n2(x.master_usage - (x.detail_usage || 0)) })) });
});
app.post('/api/periods', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.meter_id || !b.start_on || !b.end_on) return FAIL(c, '总表与起止日期必填');
  const r = await c.env.DB.prepare(`INSERT INTO meter_periods (meter_id,start_on,end_on,master_usage,master_cost)
    VALUES (?,?,?,?,?)`).bind(b.meter_id, b.start_on, b.end_on, b.master_usage || 0, b.master_cost || 0).run();
  return OK(c, { id: r.meta.last_row_id });
});
// 结算：主表费用入支出流水 + 按房间读数自动生成费用账单
app.post('/api/periods/:id/settle', async (c: any) => {
  const p = await c.env.DB.prepare(`SELECT p.*, m.building_id, m.utility FROM meter_periods p
    LEFT JOIN meters m ON m.id=p.meter_id WHERE p.id=?`).bind(c.req.param('id')).first<any>();
  if (!p) return FAIL(c, '周期不存在');
  if (p.settled) return FAIL(c, '已结算，勿重复操作');
  const d = today();
  const reads = await c.env.DB.prepare(`
    SELECT r.*, u.tenant_id, u.code AS unit_code FROM meter_readings r
    LEFT JOIN units u ON u.id=r.unit_id WHERE r.period_id=?`).bind(p.id).all();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('UPDATE meter_periods SET settled=1,settled_on=? WHERE id=?').bind(d, p.id),
    c.env.DB.prepare(`INSERT INTO ledger (building_id,direction,source,source_id,category,amount,booked_on,note)
      VALUES (?,'expense','meter',?, ?,?,?,'总表费用')`).bind(p.building_id, p.id, p.utility === 'water' ? 'utility' : 'utility', p.master_cost, d),
  ];
  for (const r of reads.results) {
    if (!(r.cost > 0)) continue;
    stmts.push(c.env.DB.prepare(`INSERT INTO invoices (unit_id,tenant_id,kind,period_start,period_end,power_usage,water_usage,amount,status,issued_on,due_on,note)
      VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?, ?)`).bind(
      r.unit_id, r.tenant_id || 0, 'utility', p.start_on, p.end_on,
      p.utility === 'power' ? r.usage : 0, p.utility === 'water' ? r.usage : 0, r.cost, today(),
      new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10),
      `${r.unit_code || ''} ${p.utility === 'power' ? '电' : '水'}费 ${r.usage}度`));
  }
  await c.env.DB.batch(stmts);
  return OK(c, { invoices_created: reads.results.filter((r: any) => r.cost > 0).length });
});
// 房间读数
app.get('/api/readings', async (c: any) => {
  const pid = c.req.query('period_id') || '';
  const rows = await c.env.DB.prepare(`
    SELECT r.*, u.code AS unit_code FROM meter_readings r
    LEFT JOIN units u ON u.id=r.unit_id ${pid ? 'WHERE r.period_id=?' : ''} ORDER BY r.read_on DESC`).bind(...(pid ? [pid] : [])).all();
  return OK(c, rows.results);
});
app.post('/api/readings', async (c: any) => {
  const b = await c.req.json<any>();
  const p = await c.env.DB.prepare(`SELECT p.*, m.building_id FROM meter_periods p
    LEFT JOIN meters m ON m.id=p.meter_id WHERE p.id=?`).bind(b.period_id).first<any>();
  if (!p) return FAIL(c, '周期不存在');
  if (p.settled) return FAIL(c, '周期已结算，禁止补录');
  if (!b.unit_id || !(b.usage >= 0)) return FAIL(c, '房间与用量必填');
  const u = await c.env.DB.prepare('SELECT * FROM units WHERE id=?').bind(b.unit_id).first<any>();
  const rate = p.utility === 'power' ? (u?.power_rate || 0) : (u?.water_rate || 0);
  const cost = n2((b.usage || 0) * rate);
  const r = await c.env.DB.prepare(`INSERT INTO meter_readings (period_id,unit_id,utility,usage,cost,read_on)
    VALUES (?,?,?,?,?,?)`).bind(b.period_id, b.unit_id, p.utility, b.usage, cost, b.read_on || today()).run();
  return OK(c, { id: r.meta.last_row_id, cost, rate });
});

// ---------- 仪表盘 ----------
app.get('/api/dashboard', async (c: any) => {
  const ym = today().slice(0, 7);
  const [b, u, t, inc, exp, rec] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) n FROM buildings'),
    c.env.DB.prepare('SELECT COUNT(*) n FROM units'),
    c.env.DB.prepare('SELECT COUNT(*) n FROM tenants'),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE direction='income' AND substr(booked_on,1,7)=?").bind(ym),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE direction='expense' AND substr(booked_on,1,7)=?").bind(ym),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='pending'"),
  ]);
  const occupied = await c.env.DB.prepare("SELECT COUNT(*) n FROM units WHERE status='occupied'").first<any>();
  return OK(c, {
    buildings: b.results[0].n, units: u.results[0].n, tenants: t.results[0].n,
    occupied: occupied?.n ?? 0,
    month_income: n2(inc.results[0].s), month_expense: n2(exp.results[0].s),
    receivable: n2(rec.results[0].s),
  });
});

// ---------- 报表（ledger 直查） ----------
app.get('/api/report', async (c: any) => {
  const year = c.req.query('year') || String(new Date().getFullYear());
  const rows = await c.env.DB.prepare(`
    SELECT substr(booked_on,1,7) ym,
      SUM(CASE WHEN direction='income' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN direction='expense' THEN amount ELSE 0 END) AS expense
    FROM ledger WHERE substr(booked_on,1,4)=? GROUP BY ym ORDER BY ym`).bind(year).all();
  const total = rows.results.reduce((s: number, x: any) => s + x.income - x.expense, 0);
  return OK(c, { year, rows: rows.results, profit: n2(total) });
});

app.notFound((c) => c.json({ code: 404, msg: 'not found', data: null }, 404));
export default app;
