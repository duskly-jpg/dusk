-- Dusk v2 · 迁移 + 演示数据（相对日期生成，始终保持"最近一月"的活样本）
-- ① 迁移管理员（保住已设密码）
INSERT OR IGNORE INTO users (username,password,salt)
  SELECT username,password,salt FROM admin_user ORDER BY id LIMIT 1;

-- ② 演示楼栋
INSERT INTO buildings (id,title,address,district,note) VALUES
 (1,'桂城公寓','天河区桂田大街 12 号','天河·棠下','电梯房，近 BRT'),
 (2,'棠下小苑','天河区棠下荷光路 3 号','天河·棠下','步梯三楼，天台晾晒'),
 (3,'车陂湾公寓','天河区车陂南东岸大街 88 号','天河·车陂','近地铁 4/5 号线');

-- ③ 演示房间（状态由租约推导，但种子直填）
INSERT INTO units (id,building_id,code,floor,area,status,rent,deposit,cycle_days,grace_days,penalty_daily,power_rate,water_rate,furnishing,tenant_id,lease_id,note) VALUES
 (1,1,'A101',1,28,'occupied',1500,1500,30,3,20,1.5,4.5,'空调/床/桌/衣柜/WiFi',1,1,''),
 (2,1,'A201',2,32,'occupied',1800,1800,30,3,20,1.5,4.5,'空调/床/桌/独立卫',2,2,''),
 (3,1,'A301',3,30,'vacant',1700,1700,30,3,20,1.5,4.5,'空调/床/桌/阳台',NULL,NULL,''),
 (4,1,'A302',3,30,'occupied',1700,1700,30,3,20,1.5,4.5,'空调/床/桌',3,3,''),
 (5,2,'B101',1,25,'occupied',1300,1300,30,5,15,1.2,4.0,'床/桌/衣柜',4,4,''),
 (6,2,'B201',2,28,'occupied',1500,1500,30,5,15,1.2,4.0,'空调/床/桌',5,5,''),
 (7,2,'B202',2,28,'reserved',1500,1500,30,5,15,1.2,4.0,'空调/床/桌',NULL,NULL,'已交定金'),
 (8,2,'B301',3,26,'vacant',1400,1400,30,5,15,1.2,4.0,'床/桌/公共厨',NULL,NULL,''),
 (9,3,'C101',1,35,'occupied',2200,2200,30,3,25,1.4,4.8,'一房一厅/空调/热水器',6,6,''),
 (10,3,'C201',2,30,'occupied',1900,1900,30,3,25,1.4,4.8,'空调/床/独立卫',7,7,''),
 (11,3,'C301',3,30,'occupied',1900,1900,30,3,25,1.4,4.8,'空调/床/飘窗',8,8,''),
 (12,3,'C302',3,30,'vacant',1850,1850,30,3,25,1.4,4.8,'空调/床',NULL,NULL,'');

-- ④ 演示租客
INSERT INTO tenants (id,name,gender,phone,id_number,hometown,employer,emergency_contact) VALUES
 (1,'陈志明','男','13711112222','4401**1988**1234','广东汕头','字节跳动广州','陈父 13788889999'),
 (2,'林晓婷','女','13822223333','4408**1995**5678','广东湛江','网易游戏','林母 13677778888'),
 (3,'王浩然','男','13633334444','4405**1992**9012','湖南长沙','自由职业','王兄 13566667777'),
 (4,'李慧敏','女','13944445555','4406**1997**3456','广东梅州','广汽研究院','李父 13455556666'),
 (5,'张文杰','男','13555556666','4416**1990**7890','广东东莞','虎牙直播','张母 13344445555'),
 (6,'黄雅静','女','13766667777','4409**1996**2345','广东清远','唯品会','黄母 13233334444'),
 (7,'刘振宇','男','13477778888','4301**1993**6789','湖南株洲','酷狗音乐','刘父 13122223333'),
 (8,'吴思琪','女','13388889999','4452**1998**4567','广东揭阳','微信事业群广州','吴母 13011112222');

-- ⑤ 租约（7 active + 1 ended）
INSERT INTO leases (id,unit_id,tenant_id,start_on,end_on,rent,deposit,status,ended_on,note) VALUES
 (1,1,1,date('now','-120 day'),date('now','+240 day'),1500,1500,'active','','年付按月交'),
 (2,2,2,date('now','-90 day'),date('now','+275 day'),1800,1800,'active','',''),
 (3,4,3,date('now','-60 day'),date('now','+305 day'),1700,1700,'active','',''),
 (4,5,4,date('now','-200 day'),date('now','+160 day'),1300,1300,'active','',''),
 (5,6,5,date('now','-15 day'),date('now','+375 day'),1500,1500,'active','','刚入住'),
 (6,9,6,date('now','-45 day'),date('now','+320 day'),2200,2200,'active','',''),
 (7,10,7,date('now','-150 day'),date('now','+215 day'),1900,1900,'active','',''),
 (8,11,8,date('now','-400 day'),date('now','-35 day'),1900,1900,'ended',date('now','-35 day'),'期满退房，押金已退');

-- ⑥ 账单：已付（进流水）+ 在缴（含 1 张已逾期罚金样本）
INSERT INTO invoices (id,unit_id,tenant_id,lease_id,kind,period_start,period_end,rent_part,amount,status,issued_on,due_on,paid_on,note) VALUES
 (1,1,1,1,'rent',date('now','-30 day'),date('now'),1500,1500,'paid',date('now','-32 day'),date('now','-25 day'),date('now','-24 day'),''),
 (2,2,2,2,'rent',date('now','-30 day'),date('now'),1800,1800,'paid',date('now','-30 day'),date('now','-23 day'),date('now','-23 day'),''),
 (3,4,3,3,'rent',date('now','-30 day'),date('now'),1700,1700,'paid',date('now','-28 day'),date('now','-21 day'),date('now','-20 day'),''),
 (4,5,4,4,'rent',date('now','-30 day'),date('now'),1300,1300,'paid',date('now','-30 day'),date('now','-25 day'),date('now','-26 day'),''),
 (5,9,6,6,'rent',date('now','-30 day'),date('now'),2200,2200,'paid',date('now','-31 day'),date('now','-24 day'),date('now','-22 day'),''),
 (6,10,7,7,'rent',date('now','-30 day'),date('now'),1900,1900,'paid',date('now','-30 day'),date('now','-23 day'),date('now','-19 day'),''),
 -- 在缴
 (7,1,1,1,'rent',date('now'),date('now','+30 day'),1500,1500,'pending',date('now','-2 day'),date('now','+12 day'),'','本期房租'),
 (8,6,5,5,'rent',date('now'),date('now','+30 day'),1500,1500,'pending',date('now','-2 day'),date('now','+13 day'),'','首期房租'),
 (9,4,3,3,'rent',date('now'),date('now','+30 day'),1700,1700,'pending',date('now','-2 day'),date('now','-7 day'),'','已逾期（宽限3天+日罚20）'),
 (10,2,2,2,'utility',date('now','-30 day'),date('now'),0,126,'pending',date('now','-1 day'),date('now','+8 day'),'','电84度+水3吨');

-- ⑦ 水电总表与读数（桂城电表：一期已结算+一期在抄）
INSERT INTO meters (id,building_id,utility,label) VALUES (1,1,'power','桂城总电表'),(2,1,'water','桂城总水表');
INSERT INTO meter_periods (id,meter_id,start_on,end_on,master_usage,master_cost,settled,settled_on) VALUES
 (1,1,date('now','-60 day'),date('now','-30 day'),620,930.0,1,date('now','-29 day')),
 (2,1,date('now','-30 day'),date('now'),540,810.0,0,'');
INSERT INTO meter_readings (period_id,unit_id,utility,usage,cost,read_on) VALUES
 (1,1,'power',260,390.0,date('now','-29 day')),
 (1,2,'power',210,315.0,date('now','-29 day')),
 (1,4,'power',150,225.0,date('now','-29 day')),
 (2,1,'power',230,345.0,date('now','-1 day')),
 (2,2,'power',180,270.0,date('now','-1 day'));

-- ⑧ 支出
INSERT INTO expenses (id,building_id,category,amount,recur,occurred_on,note) VALUES
 (1,1,'repair',260,'none',date('now','-20 day'),'A201 热水器换温控'),
 (2,1,'labor',2000,'monthly',date('now','-25 day'),'保洁阿姨月结'),
 (3,2,'supply',180,'none',date('now','-10 day'),'灯管/门锁配件'),
 (4,3,'agency',900,'none',date('now','-18 day'),'C101 中介佣金');

-- ⑨ 收支流水（与已付账单/支出对齐；月度报表有图可看）
INSERT INTO ledger (building_id,direction,source,source_id,category,amount,booked_on,note) VALUES
 (1,'income','invoice',1,'rent',1500,date('now','-24 day'),'A101 十一月房租'),
 (1,'income','invoice',2,'rent',1800,date('now','-23 day'),'A201 十一月房租'),
 (1,'income','invoice',3,'rent',1700,date('now','-20 day'),'A301 十一月房租'),
 (2,'income','invoice',4,'rent',1300,date('now','-26 day'),'B101 十一月房租'),
 (3,'income','invoice',5,'rent',2200,date('now','-22 day'),'C101 十一月房租'),
 (3,'income','invoice',6,'rent',1900,date('now','-19 day'),'C201 十一月房租'),
 (1,'income','meter',1,'utility',780.0,date('now','-29 day'),'桂城电费分摊盈余'),
 (1,'expense','expense',1,'repair',260,date('now','-20 day'),'热水器维修'),
 (1,'expense','expense',2,'labor',2000,date('now','-25 day'),'保洁月结'),
 (2,'expense','expense',3,'supply',180,date('now','-10 day'),'配件'),
 (3,'expense','expense',4,'agency',900,date('now','-18 day'),'中介佣金');

-- ⑩ 旧表清理
DROP TABLE IF EXISTS admin_user; DROP TABLE IF EXISTS admin_role; DROP TABLE IF EXISTS admin_menu;
DROP TABLE IF EXISTS admin_parameter; DROP TABLE IF EXISTS admin_permission; DROP TABLE IF EXISTS admin_subscribe;
DROP TABLE IF EXISTS house_property; DROP TABLE IF EXISTS house_number; DROP TABLE IF EXISTS house_receipt;
DROP TABLE IF EXISTS house_other; DROP TABLE IF EXISTS house_fee; DROP TABLE IF EXISTS bill_sum;
DROP TABLE IF EXISTS tenant_message; DROP TABLE IF EXISTS tenant_contract; DROP TABLE IF EXISTS tenant_maintain;
DROP TABLE IF EXISTS photo_tenant; DROP TABLE IF EXISTS photo_contract; DROP TABLE IF EXISTS we_meter;
DROP TABLE IF EXISTS we_bill; DROP TABLE IF EXISTS we_detail; DROP TABLE IF EXISTS migrations;
