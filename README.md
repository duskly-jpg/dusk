# Dusk · 出租屋管理系统

跑在 Cloudflare 免费档上的出租屋（二房东）管理后台：房产、房间、租客、合同、账单、水电分摊、收支柱报表，一套全收。零服务器、零月费，Workers + D1 免费额度即可长期运行。

[![ci](https://github.com/duskly-jpg/dusk/actions/workflows/ci.yml/badge.svg)](https://github.com/duskly-jpg/dusk/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/duskly-jpg/dusk)](LICENSE.txt)

## 功能

- **房产 / 房间**：房产增删改查；房间租金、押金、水电单价、缴费周期配置；入住 / 退房（退房自动解绑并标记）
- **账单**：一键出账（房租 + 水电按表计费 + 固定费用自动合计），到账确认按房产 / 月聚合进报表
- **租客 / 合同**：租客档案（退房未解绑保护），合同起止日期 + 剩余天数红黄绿预警
- **水电分摊**：总表建账 → 房间抄表 → 总 / 分摊用量差额一目了然；到账自动开启下一计费周期
- **其他支出**：循环支出（如房租月付）到账后自动生成下期记录
- **报表**：年度收支柱状数据（I 收入 / E 支出口径）
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

Apache-2.0（见 [LICENSE.txt](LICENSE.txt)）。业务模型参考自 [rent82](https://gitee.com/MarcoMaHH/rent82)（Apache-2.0），致谢见 [NOTICE](NOTICE)。
