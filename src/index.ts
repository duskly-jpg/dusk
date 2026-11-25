// Dusk · 出租屋管理系统 —— Hono + Cloudflare Workers + D1
// 业务模型参考 rent82 (gitee.com/MarcoMaHH/rent82, Apache-2.0)，实现全部自研，详见 NOTICE
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { pbkdf2Hash, randomHex, signToken, verifyToken } from './lib/auth';

type Bindings = { DB: D1Database; AUTH_SECRET?: string };
const app = new Hono<{ Bindings: Bindings }>();

const OK = (c: any, data: any = null, msg = 'success') => c.json({ code: 0, msg, data });
const FAIL = (c: any, msg: string, code = 1) => c.json({ code, msg, data: null }, 200);
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const SECRET = (c: any) => c.env.AUTH_SECRET || 'change-me-in-production';

// ---------- 会话 ----------
const COOKIE = 'dusk_session';
app.use('/api/*', async (c: any, next: any) => {
  const open = ['/api/auth/login', '/api/auth/setup', '/api/auth/need-setup'];
  if (open.includes(c.req.path)) return next();
  const t = getCookie(c, COOKIE);
  const id = t ? await verifyToken(SECRET(c), t) : null;
  if (!id) return FAIL(c, '未登录', 401);
  c.set('uid', id);
  return next();
});

// 首次初始化：仅 admin_user 为空时允许
app.post('/api/auth/setup', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM admin_user').first<{ n: number }>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '管理员已存在，禁止重复初始化');
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password || password.length < 8) return FAIL(c, '用户名必填，密码≥8位');
  const salt = randomHex();
  const hash = await pbkdf2Hash(password, salt);
  const r = await c.env.DB.prepare(
    'INSERT INTO admin_user (admin_role_id,username,password,salt) VALUES (?,?,?,?)'
  ).bind(1, username, hash, salt).run();
  return OK(c, { id: r.meta.last_row_id });
});

app.get('/api/auth/need-setup', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM admin_user').first<{ n: number }>();
  return OK(c, { need_setup: (n?.n ?? 0) === 0 });
});

app.post('/api/auth/login', async (c: any) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  const u = await c.env.DB.prepare('SELECT id,password,salt FROM admin_user WHERE username=?').bind(username ?? '').first<any>();
  if (!u) return FAIL(c, '账号或密码错误');
  const hash = await pbkdf2Hash(password ?? '', u.salt);
  if (hash !== u.password) return FAIL(c, '账号或密码错误');
  await c.env.DB.prepare('UPDATE admin_user SET login_date=? WHERE id=?').bind(now(), u.id).run();
  const token = await signToken(SECRET(c), u.id);
  c.header('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
  return OK(c, { uid: u.id, username });
});

app.post('/api/auth/logout', (c: any) => {
  c.header('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
  return OK(c);
});

app.get('/api/auth/me', async (c: any) => {
  const u = await c.env.DB.prepare('SELECT id,username,admin_role_id,login_date FROM admin_user WHERE id=?').bind(c.get('uid')).first();
  return OK(c, u);
});

// ---------- 菜单（驱动侧栏） ----------
app.get('/api/menu', async (c: any) => {
  const rows = await c.env.DB.prepare('SELECT id,pid,name,icon,controller FROM admin_menu ORDER BY pid,sort').all<any>();
  const top = rows.results.filter((r) => r.pid === 0);
  return OK(c, top.map((t) => ({ ...t, children: rows.results.filter((r) => r.pid === t.id) })));
});

// ---------- 房产 ----------
// 房间在租状态 = tenant_message_id 非空非零（原版无 state 列）
const RENTED = 'n.tenant_message_id IS NOT NULL AND n.tenant_message_id != 0';
app.get('/api/property', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM house_number n WHERE n.house_property_id=p.id) AS room_total,
      (SELECT COUNT(*) FROM house_number n WHERE n.house_property_id=p.id AND ${RENTED}) AS room_rented,
      (SELECT COUNT(*) FROM house_receipt r WHERE r.house_property_id=p.id AND r.accounting_date IS NULL) AS bill_unpaid
    FROM house_property p ORDER BY p.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/property', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.name) return FAIL(c, '房产名必填');
  const r = await c.env.DB.prepare(
    'INSERT INTO house_property (admin_user_id,name,name_show,address,landlord,phone,id_card,is_default) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(c.get('uid'), b.name, b.name_show || '', b.address || '', b.landlord || '', b.phone || '', b.id_card || '', b.is_default || 'N').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/property/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    'UPDATE house_property SET name=?,name_show=?,address=?,landlord=?,phone=?,id_card=?,is_default=?,update_time=? WHERE id=?'
  ).bind(b.name, b.name_show || '', b.address || '', b.landlord || '', b.phone || '', b.id_card || '', b.is_default || 'N', now(), c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/property/:id', async (c: any) => {
  const rooms = await c.env.DB.prepare('SELECT COUNT(*) n FROM house_number WHERE house_property_id=?').bind(c.req.param('id')).first<{ n: number }>();
  if ((rooms?.n ?? 0) > 0) return FAIL(c, '房产下还有房间，禁止删除');
  await c.env.DB.prepare('DELETE FROM house_property WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 房间 ----------
app.get('/api/number', async (c: any) => {
  const pid = c.req.query('property_id') || '';
  const rows = await c.env.DB.prepare(`
    SELECT n.*, t.name AS tenant_name, t.phone AS tenant_phone, t.checkin_date AS tenant_checkin
    FROM house_number n LEFT JOIN tenant_message t ON t.id=n.tenant_message_id
    ${pid ? 'WHERE n.house_property_id=?' : ''} ORDER BY n.id DESC`).bind(...(pid ? [pid] : [])).all();
  return OK(c, rows.results);
});
app.post('/api/number', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.house_property_id || !b.name) return FAIL(c, '房产与房号必填');
  const r = await c.env.DB.prepare(`
    INSERT INTO house_number (house_property_id,name,rental,deposit,daily_rent,payment_date,cycle,cycle_type,calculate_date,lease,
      water_price,electricity_price,fees1,fees2,fees3,fees4,equipment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    b.house_property_id, b.name, b.rental ?? 0, b.deposit ?? 0, b.daily_rent ?? 0, b.payment_date || null,
    b.cycle ?? 1, b.cycle_type || 'month', b.calculate_date || now(), b.lease ?? 0,
    b.water_price ?? 0, b.electricity_price ?? 0, b.fees1 ?? 0, b.fees2 ?? 0, b.fees3 ?? 0, b.fees4 ?? 0,
    b.equipment || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/number/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare(`
    UPDATE house_number SET house_property_id=?,name=?,rental=?,deposit=?,daily_rent=?,payment_date=?,cycle=?,cycle_type=?,
      calculate_date=?,lease=?,water_price=?,electricity_price=?,fees1=?,fees2=?,fees3=?,fees4=?,equipment=?,update_time=? WHERE id=?`).bind(
    b.house_property_id, b.name, b.rental ?? 0, b.deposit ?? 0, b.daily_rent ?? 0, b.payment_date || null, b.cycle ?? 1,
    b.cycle_type || 'month', b.calculate_date || now(), b.lease ?? 0, b.water_price ?? 0, b.electricity_price ?? 0,
    b.fees1 ?? 0, b.fees2 ?? 0, b.fees3 ?? 0, b.fees4 ?? 0, b.equipment || '', now(), c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/number/:id', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT tenant_message_id FROM house_number WHERE id=?').bind(c.req.param('id')).first<any>();
  if (n?.tenant_message_id) return FAIL(c, '房间在租中，请先办理退房');
  await c.env.DB.prepare('DELETE FROM house_number WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// 入住：登记租客并绑定房号；退房：标记退房并解绑
app.post('/api/number/:id/checkin', async (c: any) => {
  const b = await c.req.json<any>();
  const num = await c.env.DB.prepare('SELECT house_property_id,tenant_message_id FROM house_number WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!num) return FAIL(c, '房间不存在');
  if (num.tenant_message_id) return FAIL(c, '房间已在租');
  if (!b.name) return FAIL(c, '租客姓名必填');
  const tenant = await c.env.DB.prepare(
    'INSERT INTO tenant_message (house_property_id,house_number_id,name,sex,phone,id_card_number,native_place,work_units,note,checkin_date) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(num.house_property_id, c.req.param('id'), b.name, b.sex || '', b.phone || '', b.id_card_number || '',
    b.native_place || '', b.work_units || '', b.note || '', now()).run();
  const tid = tenant.meta.last_row_id;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE house_number SET tenant_message_id=?,checkin_date=?,update_time=? WHERE id=?').bind(tid, now(), now(), c.req.param('id')),
    c.env.DB.prepare('INSERT INTO tenant_contract (house_property_id,house_number_id,tenant_message_id,type,start_date) VALUES (?,?,?,?,?)')
      .bind(num.house_property_id, c.req.param('id'), tid, b.contract_type || 'Y', now()),
  ]);
  return OK(c, { tenant_id: tid });
});
app.post('/api/number/:id/checkout', async (c: any) => {
  const num = await c.env.DB.prepare('SELECT tenant_message_id FROM house_number WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!num?.tenant_message_id) return FAIL(c, '房间未在租');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tenant_message SET checkout_mark=?,leave_date=?,update_time=? WHERE id=?').bind('Y', now(), now(), num.tenant_message_id),
    c.env.DB.prepare('UPDATE house_number SET tenant_message_id=NULL,house_receipt_id=NULL,update_time=? WHERE id=?').bind(now(), c.req.param('id')),
  ]);
  return OK(c);
});

// ---------- 账单（收据） ----------
// bill_type: A房租 B逾期 C退房；accounting_date IS NULL = 未收
app.get('/api/receipt', async (c: any) => {
  const pid = c.req.query('property_id') || '';
  const collected = c.req.query('type') === 'collected';
  const where = `WHERE r.accounting_date IS ${collected ? 'NOT' : ''} NULL${pid ? ' AND r.house_property_id=?' : ''}`;
  const rows = await c.env.DB.prepare(`
    SELECT r.*, p.name AS property_name, n.name AS number_name, t.name AS tenant_name
    FROM house_receipt r
    LEFT JOIN house_property p ON p.id=r.house_property_id
    LEFT JOIN house_number n ON n.id=r.house_number_id
    LEFT JOIN tenant_message t ON t.id=r.tenant_message_id
    ${where} ORDER BY r.id DESC`).bind(...(pid ? [pid] : [])).all();
  const sum = (rows.results as any[]).reduce((s, r) => s + (r.total_money || 0), 0);
  return OK(c, { list: rows.results, sum });
});

// 生成账单：租金 + 电费(用量×单价) + 水费 + 杂费
app.post('/api/receipt', async (c: any) => {
  const b = await c.req.json<any>();
  const n = await c.env.DB.prepare('SELECT * FROM house_number WHERE id=?').bind(b.house_number_id).first<any>();
  if (!n) return FAIL(c, '房间不存在');
  const eUsage = Math.max(0, (b.electricity_meter_this_month ?? 0) - (b.electricity_meter_last_month ?? 0));
  const wUsage = Math.max(0, (b.water_meter_this_month ?? 0) - (b.water_meter_last_month ?? 0));
  const eSum = Math.round(eUsage * (n.electricity_price || 0) * 100) / 100;
  const wSum = Math.round(wUsage * (n.water_price || 0) * 100) / 100;
  const f1 = b.fees1 ?? n.fees1 ?? 0, f2 = b.fees2 ?? n.fees2 ?? 0, f3 = b.fees3 ?? n.fees3 ?? 0, f4 = b.fees4 ?? n.fees4 ?? 0;
  const total = Math.round(((n.rental || 0) + eSum + wSum + f1 + f2 + f3 + f4) * 100) / 100;
  const r = await c.env.DB.prepare(`
    INSERT INTO house_receipt (bill_type,house_property_id,house_number_id,tenant_message_id,start_time,end_time,meter_reading_time,
      electricity_meter_this_month,electricity_meter_last_month,electricity_consumption,electricity,
      water_meter_this_month,water_meter_last_month,water_consumption,water,
      rental,deposit,fees1,fees2,fees3,fees4,total_money,note,accounting_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(
    b.bill_type || 'A', n.house_property_id, n.id, n.tenant_message_id || 0,
    b.start_time || null, b.end_time || null, now(),
    b.electricity_meter_this_month ?? null, b.electricity_meter_last_month ?? null, eUsage, eSum,
    b.water_meter_this_month ?? null, b.water_meter_last_month ?? null, wUsage, wSum,
    n.rental, b.deposit ?? 0, f1, f2, f3, f4, total, b.note || '').run();
  return OK(c, { id: r.meta.last_row_id, total, electricity: eSum, water: wSum });
});

// 到账确认：标记 + 计入 bill_sum（原版口径：type=I 收入，按房产+月聚合）
app.post('/api/receipt/:id/accounting', async (c: any) => {
  const r = await c.env.DB.prepare('SELECT * FROM house_receipt WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!r) return FAIL(c, '账单不存在');
  if (r.accounting_date) return FAIL(c, '已到账，勿重复确认');
  const d = now();
  const ym = d.slice(0, 7);
  const uid = c.get('uid');
  // 聚合：同房产同月已有 I 记录则累加（原版语义）
  const exist = await c.env.DB.prepare(
    'SELECT id,amount FROM bill_sum WHERE house_property_id=? AND type=? AND substr(accounting_date,1,7)=?'
  ).bind(r.house_property_id, 'I', ym).first<any>();
  const stmt = exist
    ? c.env.DB.prepare('UPDATE bill_sum SET amount=amount+? WHERE id=?').bind(r.total_money, exist.id)
    : c.env.DB.prepare('INSERT INTO bill_sum (admin_user_id,house_property_id,type,amount,accounting_date,annual) VALUES (?,?,?,?,?,?)')
        .bind(uid, r.house_property_id, 'I', r.total_money, ym, ym.slice(0, 4));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE house_receipt SET accounting_date=?,update_time=? WHERE id=?').bind(d, d, r.id),
    stmt,
  ]);
  return OK(c);
});
app.delete('/api/receipt/:id', async (c: any) => {
  const r = await c.env.DB.prepare('SELECT accounting_date FROM house_receipt WHERE id=?').bind(c.req.param('id')).first<any>();
  if (r?.accounting_date) return FAIL(c, '已到账账单不可删除');
  await c.env.DB.prepare('DELETE FROM house_receipt WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 其他支出 ----------
app.get('/api/other', async (c: any) => {
  const pid = c.req.query('property_id') || '';
  const rows = await c.env.DB.prepare(`SELECT * FROM house_other ${pid ? 'WHERE house_property_id=?' : ''} ORDER BY id DESC`)
    .bind(...(pid ? [pid] : [])).all();
  return OK(c, rows.results);
});
app.post('/api/other', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.house_property_id || !b.type) return FAIL(c, '房产与类型必填');
  const r = await c.env.DB.prepare(
    'INSERT INTO house_other (house_property_id,type,total_money,note,accounting_date) VALUES (?,?,?,?,?)'
  ).bind(b.house_property_id, b.type, b.total_money ?? 0, b.note || '', b.accounting_date || now()).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.delete('/api/other/:id', async (c: any) => {
  await c.env.DB.prepare('DELETE FROM house_other WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 报表（原版口径：bill_sum I=收入 E=支出） ----------
app.get('/api/report', async (c: any) => {
  const year = c.req.query('year') || String(new Date().getFullYear());
  const income = await c.env.DB.prepare(`
    SELECT substr(accounting_date,1,7) ym, SUM(amount) total, COUNT(*) cnt FROM bill_sum
    WHERE type='I' AND substr(accounting_date,1,4)=? GROUP BY ym ORDER BY ym`).bind(year).all();
  const expense = await c.env.DB.prepare(`
    SELECT substr(accounting_date,1,7) ym, SUM(amount) total FROM bill_sum
    WHERE type='E' AND substr(accounting_date,1,4)=? GROUP BY ym ORDER BY ym`).bind(year).all();
  return OK(c, { year, income: income.results, expense: expense.results });
});

// ---------- 其他支出·到账（原版语义：循环支出自动生成下月记录） ----------
app.post('/api/other/:id/account', async (c: any) => {
  const o = await c.env.DB.prepare('SELECT * FROM house_other WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!o) return FAIL(c, '到账失败，记录不存在');
  if (o.accout_mark === 'Y') return FAIL(c, '已到账，勿重复确认');
  const d = now(), ym = d.slice(0, 7);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('UPDATE house_other SET accout_mark=?,accounting_date=?,update_time=? WHERE id=?').bind('Y', d, d, o.id),
  ];
  if (o.circulate_mark === 'Y') {
    // 自动生成下月同额支出（accout_mark 复位 N）
    const next = new Date(d.slice(0, 10)); next.setMonth(next.getMonth() + 1);
    stmts.push(c.env.DB.prepare(`INSERT INTO house_other (house_property_id,type,total_money,note,accout_mark,circulate_mark,accounting_date)
      VALUES (?,?,?,?,'N','Y',?)`).bind(o.house_property_id, o.type, o.total_money, o.note, next.toISOString().slice(0, 10)));
  }
  const exist = await c.env.DB.prepare(
    "SELECT id FROM bill_sum WHERE house_property_id=? AND type='E' AND substr(accounting_date,1,7)=?"
  ).bind(o.house_property_id, ym).first<any>();
  stmts.push(exist
    ? c.env.DB.prepare("UPDATE bill_sum SET amount=amount+? WHERE id=?").bind(o.total_money, exist.id)
    : c.env.DB.prepare("INSERT INTO bill_sum (admin_user_id,house_property_id,type,amount,accounting_date,annual) VALUES (?,?,?,?,?,?)")
        .bind(c.get('uid'), o.house_property_id, 'E', o.total_money, ym, ym.slice(0, 4)));
  await c.env.DB.batch(stmts);
  return OK(c);
});

// ---------- 租客档案 ----------
app.get('/api/tenant', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT t.*, n.name AS room_name, p.name AS property_name FROM tenant_message t
    LEFT JOIN house_number n ON n.id=t.house_number_id
    LEFT JOIN house_property p ON p.id=t.house_property_id
    ORDER BY t.checkout_mark, t.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/tenant', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.name) return FAIL(c, '姓名必填');
  const r = await c.env.DB.prepare(`INSERT INTO tenant_message
    (house_property_id,house_number_id,name,sex,phone,id_card_number,native_place,work_units,note,checkin_date)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
    b.house_property_id || 0, b.house_number_id || 0, b.name, b.sex || '', b.phone || '',
    b.id_card_number || '', b.native_place || '', b.work_units || '', b.note || '', b.checkin_date || now()).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/tenant/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare(`UPDATE tenant_message SET name=?,sex=?,phone=?,id_card_number=?,native_place=?,work_units=?,note=?,update_time=?
    WHERE id=?`).bind(b.name, b.sex || '', b.phone || '', b.id_card_number || '', b.native_place || '', b.work_units || '', b.note || '', now(), c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/tenant/:id', async (c: any) => {
  const bind = await c.env.DB.prepare('SELECT COUNT(*) n FROM house_number WHERE tenant_message_id=?').bind(c.req.param('id')).first<any>();
  if ((bind?.n ?? 0) > 0) return FAIL(c, '租客仍绑定房间，请先退房');
  await c.env.DB.prepare('DELETE FROM tenant_message WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 合同 ----------
app.get('/api/contract', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT ct.*, t.name AS tenant_name, n.name AS room_name, p.name AS property_name,
      julianday(ct.end_date)-julianday('now') AS days_left
    FROM tenant_contract ct
    LEFT JOIN tenant_message t ON t.id=ct.tenant_message_id
    LEFT JOIN house_number n ON n.id=ct.house_number_id
    LEFT JOIN house_property p ON p.id=ct.house_property_id
    ORDER BY ct.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/contract', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.tenant_message_id || !b.start_date || !b.end_date) return FAIL(c, '租客与起止日期必填');
  const r = await c.env.DB.prepare(`INSERT INTO tenant_contract
    (house_property_id,house_number_id,tenant_message_id,type,start_date,end_date)
    VALUES (?,?,?,?,?,?)`).bind(
    b.house_property_id || 0, b.house_number_id || 0, b.tenant_message_id, b.type || 'Y', b.start_date, b.end_date).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.put('/api/contract/:id', async (c: any) => {
  const b = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE tenant_contract SET type=?,start_date=?,end_date=?,update_time=? WHERE id=?')
    .bind(b.type || 'Y', b.start_date, b.end_date, now(), c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/contract/:id', async (c: any) => {
  await c.env.DB.prepare('DELETE FROM tenant_contract WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 维修申请 ----------
app.get('/api/maintain', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT m.*, n.name AS room_name, p.name AS property_name FROM tenant_maintain m
    LEFT JOIN house_number n ON n.id=m.house_number_id
    LEFT JOIN house_property p ON p.id=m.house_property_id
    ORDER BY m.status, m.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/maintain', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.description) return FAIL(c, '说明必填');
  const r = await c.env.DB.prepare(`INSERT INTO tenant_maintain (house_property_id,house_number_id,status,description)
    VALUES (?,?,?,?)`).bind(b.house_property_id || 0, b.house_number_id || 0, b.status || 'N', b.description).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.post('/api/maintain/:id/toggle', async (c: any) => {
  const m = await c.env.DB.prepare('SELECT status FROM tenant_maintain WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!m) return FAIL(c, '记录不存在');
  await c.env.DB.prepare('UPDATE tenant_maintain SET status=?,update_time=? WHERE id=?')
    .bind(m.status === 'Y' ? 'N' : 'Y', now(), c.req.param('id')).run();
  return OK(c);
});
app.delete('/api/maintain/:id', async (c: any) => {
  await c.env.DB.prepare('DELETE FROM tenant_maintain WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 水电总表 ----------
app.get('/api/meter', async (c: any) => {
  const rows = await c.env.DB.prepare(`
    SELECT m.*, p.name AS property_name,
      (SELECT COUNT(*) FROM we_bill wb WHERE wb.meter_id=m.id) AS bill_count
    FROM we_meter m LEFT JOIN house_property p ON p.id=m.house_property_id
    ORDER BY m.id DESC`).all();
  return OK(c, rows.results);
});
app.post('/api/meter', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.house_property_id || !b.name || !b.type) return FAIL(c, '房产/名称/类型必填');
  const r = await c.env.DB.prepare('INSERT INTO we_meter (name,type,house_property_id,house_number_id) VALUES (?,?,?,?)')
    .bind(b.name, b.type, b.house_property_id, b.house_number_id || '').run();
  return OK(c, { id: r.meta.last_row_id });
});
app.delete('/api/meter/:id', async (c: any) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM we_bill WHERE meter_id=?').bind(c.req.param('id')).first<any>();
  if ((n?.n ?? 0) > 0) return FAIL(c, '总表下已有账单，禁止删除');
  await c.env.DB.prepare('DELETE FROM we_meter WHERE id=?').bind(c.req.param('id')).run();
  return OK(c);
});

// ---------- 水费/电费账单（type W水/E电，语义同原版 Water/Electricity） ----------
app.get('/api/webill', async (c: any) => {
  const type = c.req.query('type') === 'E' ? 'E' : 'W';
  const rows = await c.env.DB.prepare(`
    SELECT b.*, m.name AS meter_name, p.name AS property_name,
      (SELECT SUM(d.dosage) FROM we_detail d WHERE d.meter_id=b.meter_id AND d.type=? AND d.calculate_date>=b.start_month AND d.calculate_date<=b.end_month) AS detail_dosage,
      (SELECT SUM(d.amount) FROM we_detail d WHERE d.meter_id=b.meter_id AND d.type=? AND d.calculate_date>=b.start_month AND d.calculate_date<=b.end_month) AS detail_sum
    FROM we_bill b LEFT JOIN we_meter m ON m.id=b.meter_id LEFT JOIN house_property p ON p.id=b.house_property_id
    WHERE m.type=? ORDER BY b.id DESC`).bind(type, type, type).all();
  return OK(c, { list: rows.results.map((x: any) => ({ ...x,
    difference_dosage: x.master_dosage - (x.detail_dosage || 0) })) });
});
app.post('/api/webill', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.meter_id || !b.start_month || !b.end_month) return FAIL(c, '总表与起止月份必填');
  const m = await c.env.DB.prepare('SELECT * FROM we_meter WHERE id=?').bind(b.meter_id).first<any>();
  if (!m) return FAIL(c, '总表不存在');
  const r = await c.env.DB.prepare(`INSERT INTO we_bill (meter_id,house_property_id,start_month,end_month,master_dosage,master_sum)
    VALUES (?,?,?,?,?,?)`).bind(b.meter_id, m.house_property_id, b.start_month, b.end_month, b.master_dosage || 0, b.master_sum || 0).run();
  return OK(c, { id: r.meta.last_row_id });
});
// 到账：标记 + 写 bill_sum 支出 + 自动开新期（原版语义）
app.post('/api/webill/:id/account', async (c: any) => {
  const b = await c.env.DB.prepare('SELECT * FROM we_bill WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!b) return FAIL(c, '账单不存在');
  if (b.accounting_date) return FAIL(c, '已到账，勿重复确认');
  const d = now(), ym = d.slice(0, 7);
  const nextStart = new Date(b.end_month + 'T00:00:00Z'); nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const exist = await c.env.DB.prepare(
    "SELECT id FROM bill_sum WHERE house_property_id=? AND type='E' AND substr(accounting_date,1,7)=?"
  ).bind(b.house_property_id, ym).first<any>();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE we_bill SET accounting_date=?,update_time=? WHERE id=?').bind(d, d, b.id),
    c.env.DB.prepare(`INSERT INTO we_bill (meter_id,house_property_id,start_month,end_month,master_dosage,master_sum)
      VALUES (?,?,?,?,?,0)`).bind(b.meter_id, b.house_property_id, nextStart.toISOString().slice(0, 10), '', 0),
    exist
      ? c.env.DB.prepare("UPDATE bill_sum SET amount=amount+? WHERE id=?").bind(b.master_sum, exist.id)
      : c.env.DB.prepare("INSERT INTO bill_sum (admin_user_id,house_property_id,type,amount,accounting_date,annual) VALUES (?,?,?,?,?,?)")
          .bind(c.get('uid'), b.house_property_id, 'E', b.master_sum, ym, ym.slice(0, 4)),
  ]);
  return OK(c);
});
// 房间分摊明细（抄表记录）
app.post('/api/webill/detail', async (c: any) => {
  const b = await c.req.json<any>();
  if (!b.meter_id || !b.type || !b.calculate_date) return FAIL(c, '总表/类型/抄表日期必填');
  const r = await c.env.DB.prepare(`INSERT INTO we_detail (meter_id,house_property_id,type,amount,dosage,calculate_date)
    VALUES (?,?,?,?,?,?)`).bind(b.meter_id, b.house_property_id || 0, b.type, b.amount || 0, b.dosage || 0, b.calculate_date).run();
  return OK(c, { id: r.meta.last_row_id });
});
app.get('/api/webill/detail', async (c: any) => {
  const mid = c.req.query('meter_id') || '';
  const rows = await c.env.DB.prepare(`
    SELECT d.*, n.name AS room_name FROM we_detail d
    LEFT JOIN house_number n ON CAST(n.id AS TEXT)=d.house_number_id
    ${mid ? 'WHERE d.meter_id=?' : ''} ORDER BY d.calculate_date DESC`).bind(...(mid ? [mid] : [])).all();
  return OK(c, rows.results);
});

// ---------- 改密码 ----------
app.post('/api/auth/password', async (c: any) => {
  const { old_password, new_password } = await c.req.json<any>();
  if (!new_password || new_password.length < 8) return FAIL(c, '新密码≥8位');
  const u = await c.env.DB.prepare('SELECT * FROM admin_user WHERE id=?').bind(c.get('uid')).first<any>();
  const oldHash = await pbkdf2Hash(old_password || '', u.salt);
  if (oldHash !== u.password) return FAIL(c, '原密码错误');
  const salt = randomHex();
  const hash = await pbkdf2Hash(new_password, salt);
  await c.env.DB.prepare('UPDATE admin_user SET password=?,salt=?,update_time=? WHERE id=?').bind(hash, salt, now(), u.id).run();
  return OK(c);
});

app.notFound((c) => c.json({ code: 404, msg: 'not found', data: null }, 404));
export default app;
