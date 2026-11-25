-- 种子数据（自 rent82 种子忠实移植；admin 用户不落种子，走 /api/auth/setup 首次设置）
INSERT OR IGNORE INTO admin_menu (id,pid,name,icon,controller,sort) VALUES
 (1,0,'设置','system-setting','admin',9),
 (2,1,'菜单管理','','admin.menu',1),(3,1,'角色管理','','admin.role',2),
 (4,1,'权限管理','','admin.permission',3),(5,1,'用户管理','','admin.user',4),
 (10,0,'房屋管理','houses','house',1),
 (11,10,'房产管理','','house.property',1),(12,10,'房间管理','','house.number',2),
 (13,10,'未收账单','','house.uncollected',4),(14,10,'到账账单','','house.collected',5),
 (15,10,'其他支出','','house.other',8),
 (20,0,'租客管理','user-business','tenant',2),
 (21,20,'租客信息','','tenant.message',1),(22,20,'合同管理','','tenant.contract',2),
 (23,20,'维修申请','','tenant.maintain',3),
 (30,0,'水电管理','bill','we',3),
 (31,30,'水电总表','','we.meter',1),(32,30,'水费账单','','we.water',2),(33,30,'电费账单','','we.electricity',3),
 (40,0,'我的账本','chart-line-data-1','bill',4),
 (41,40,'房产报表','','bill.report',1),(42,40,'年度报表','','bill.annual',2);

INSERT OR IGNORE INTO admin_parameter (id,name,label,value,note) VALUES
 (1,'ymd','年','year',NULL),(2,'ymd','月','month',NULL),(3,'ymd','日','day',NULL),
 (11,'bill_type','房租账单','A','primary'),(12,'bill_type','逾期账单','B','danger'),(13,'bill_type','退房账单','C','default');

INSERT OR IGNORE INTO admin_role (id,name,state) VALUES (1,'管理员','Y'),(2,'普通会员','Y');

INSERT OR IGNORE INTO admin_permission (id,admin_role_id,controller,action) VALUES
 (1,1,'*','*'),
 (10,2,'index','*'),(11,2,'house','index'),
 (12,2,'house.property','*'),(13,2,'house.number','*'),(14,2,'house.uncollected','*'),
 (15,2,'house.collected','*'),(16,2,'house.other','*'),(17,2,'house.fee','*'),(18,2,'house.receipt','*'),
 (20,2,'tenant','*'),(21,2,'tenant.message','*'),(22,2,'tenant.contract','*'),(23,2,'tenant.maintain','*'),
 (30,2,'we','index'),(31,2,'we.meter','*'),(32,2,'we.water','*'),(33,2,'we.electricity','*'),
 (40,2,'bill','index'),(41,2,'bill.report','*'),(42,2,'bill.annual','*'),
 (50,2,'admin.parameter','*'),(60,2,'property','*'),(61,2,'number','*'),(62,2,'uncollected','*'),
 (63,2,'collected','*'),(64,2,'contract','*'),(65,2,'tenant','*'),(66,2,'report','*'),(67,2,'user','*'),(68,2,'fee','*');
