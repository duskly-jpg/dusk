# Dusk · 出租屋管理系统

跑在 Cloudflare 免费档上的出租屋（二房东）管理后台：房产、房间、租客、合同、账单、水电分摊、收支柱报表，一套全收。零服务器、零月费，Workers + D1 免费额度即可长期运行。

[![ci](https://github.com/duskly-jpg/dusk/actions/workflows/ci.yml/badge.svg)](https://github.com/duskly-jpg/dusk/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/duskly-jpg/dusk)](LICENSE)

## 功能

- **仪表盘**：楼 / 房 / 客 KPI、本月收支、应收账款一眼清
- **房产 / 房间**：楼栋管理、房间档案（面积/楼层/设施/水电单价），状态由租约生命周期推导
- **租约**：入住即建约，到期剩余天数红黄绿预警，退房一键解绑复位
- **账单**：发票式计费（房租 / 水电 / 罚金 / 退押），应缴日 + 逾期天数实时计算，宽限期 + 日罚金引擎一键计罚
- **水电分摊**：计费周期显式创建 → 房间抄表 → 总 / 分摊用量差额一目了然，结算自动生成各房费用账单与支出流水
- **收支流水**：单笔入账可溯源（账单 / 支出 / 水电），循环支出自动生成下期
- **鉴权**：PBKDF2-SHA256 口令哈希 + HMAC 会话令牌，HttpOnly Cookie，首次访问引导初始化管理员

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers（免费档） |
| 后端 | Hono（TypeScript） |
| 数据库 | Cloudflare D1（SQLite） |
| 前端 | Vue 3 + TDesign（本地自托管，无外链 CDN） |
| 鉴权 | WebCrypto PBKDF2 + HMAC，`hono/cookie` |

## 部署（约 10 分钟）

```bash
# 1. 安装依赖
npm install

# 2. 建 D1 库并记下 database_id
npx wrangler d1 create dusk

# 3. 写真实配置（参考 wrangler.example.jsonc）
cp wrangler.example.jsonc wrangler.jsonc
#    填入 database_id 与你的域名 route

# 4. 灌表结构 + 种子数据
npx wrangler d1 execute dusk --remote --file=schema.sql
npx wrangler d1 execute dusk --remote --file=seed.sql

# 5. 设置会话签名密钥
openssl rand -hex 32 | npx wrangler secret put AUTH_SECRET

# 6. 部署
npx wrangler deploy
```

首次访问会引导创建管理员账号；请勿在生产环境使用代码内 fallback 密钥（`AUTH_SECRET` 必须设置）。

## 仓库纪律

- **域名即配置**：代码零硬编码域名，`wrangler.jsonc`（真实配置）不入仓
- **密钥零落盘**：`AUTH_SECRET` 走 `wrangler secret`，代码只出现变量名
- **部署断言闸门**：发布前 HTML 标签配对 / 关键串断言，FAIL 拒发

## License

MIT（见 [LICENSE](LICENSE)）。
