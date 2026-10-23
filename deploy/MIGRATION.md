# 部署到阿里云 ECS：操作手册（同机数据库版）

> 目标：把 Next.js 和 PostgreSQL 都放在那台 ECS 上，彻底去掉两次跨境。
> 服务器的实际情况：2 核 2G / CentOS 7.9 / 3Mbps 带宽 / 宝塔面板 / 深圳。

---

## 零、先看三个硬约束

### 1. 带宽 3 Mbps 是真正的新瓶颈

构建产物里静态资源 1.8 MB，gzip 后约 600 KB。3 Mbps ≈ 375 KB/s，首屏传输理论最快 **1.6 秒**，实际 2-3 秒。

好消息：**这个问题现在就已经存在**——静态资源经反代回源时也是从这台机器出去的。
迁移后反而有改善：Nginx 直接给文件（不经过 Node）+ gzip + 一年强缓存，第二次访问几乎不下载。

如果之后觉得还是慢，优先升带宽到 5-10 Mbps，或者把 `.next/static` 丢到 OSS + CDN。

### 2. 2 GB 内存不够跑构建

Next.js 构建峰值要吃 1 GB 以上，和 PostgreSQL、宝塔面板挤在 2G 里会 OOM。**必须先加 swap**，这是 Step 0 的第一件事。

### 3. CentOS 7 只能上 Node 20，不能上 22

Node 22 要求 glibc 2.28，CentOS 7 只有 2.17。Node 20 要求 glibc 2.17，刚好过关。
Next.js 16 要求 Node >= 20.9，所以 **Node 20（20.9 以上）是唯一可行版本**。

另外 CentOS 7 已 EOL，官方 yum 源失效，装软件一律走宝塔的源，不要用 `yum install`。

---

## Step 0 · 环境检查与准备

宝塔 → 终端，或 SSH 登录后执行：

```bash
# 看内存和已装服务（决定要不要关掉 MySQL 之类）
free -h
systemctl list-units --type=service --state=running | head -20

# 加 2G swap（2G 内存的机器必做）
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h   # 确认 Swap 那一行有值
```

> 如果宝塔里装了 MySQL 且这个项目用不到（项目只用 PostgreSQL），去软件商店把它停掉，能省 300MB 内存。

---

## Step 1 · 安装 PostgreSQL（宝塔）

1. 宝塔 → 软件商店 → 搜 **PostgreSQL**（或「PostgreSQL 管理器」）→ 安装
2. 版本选 **14 或 15** 都行
3. 安装完在插件里建：
   - 数据库名：`laroja`
   - 用户名：`laroja`
   - 密码：**自己生成一个强的，记下来**
   - 访问权限选 **本地服务器**（不要开外网）

记下 PostgreSQL 客户端路径，后面备份脚本要用：

```bash
ls /www/server/pgsql/bin/pg_dump
```

---

## Step 2 · 传代码并导入数据

本地执行（把下面命令里的 `YOUR_SERVER_IP` 换成实际地址）：

```bash
# 代码
scp -r . root@YOUR_SERVER_IP:/www/wwwroot/laroja

# 迁移用的两个 SQL（含真实数据，别进 git）
scp -r .cache/migration root@YOUR_SERVER_IP:/tmp/laroja-migration
```

服务器上：

```bash
cd /www/wwwroot/laroja
npm ci

# 导入（本地 PostgreSQL 不开 SSL）
DATABASE_SSL=off \
TARGET_DATABASE_URL='postgresql://laroja:你设的密码@127.0.0.1:5432/laroja' \
node scripts/import-data.js --dir /tmp/laroja-migration
```

预期输出 17 张表、499 行，且 `✓ 全部一致`。

> 如果 `npm ci` 因为内存不够被杀，先把 Step 0 的 swap 加上再重试。

---

## Step 3 · 配置环境变量并构建

在 `/www/wwwroot/laroja/.env.local` 写入：

```bash
DATABASE_URL=postgresql://laroja:你设的密码@127.0.0.1:5432/laroja
DATABASE_SSL=off
AUTH_SECRET=从 Vercel 复制的原值
ADMIN_NAMES=dom
```

> **`AUTH_SECRET` 必须沿用 Vercel 上的原值**，否则所有群友被强制登出。

构建。2G 内存下加个内存上限，避免 OOM：

```bash
NODE_OPTIONS=--max-old-space-size=1536 npm run build
```

装 PM2 并启动：

```bash
npm i -g pm2
mkdir -p logs
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup        # 按它输出的那条命令再执行一次
```

本机自测：

```bash
curl -I http://127.0.0.1:3000
curl -s http://127.0.0.1:3000/api/players | head -c 150
```

---

## Step 4 · 改 Nginx

宝塔 → 网站 → 你的站点 → 设置 → 配置文件。

把原来的 `proxy_pass`（指向 Vercel 地址）改成：

```nginx
proxy_pass http://127.0.0.1:3000;
```

并确保有这几个头（缺了登录态会异常）：

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

`deploy/nginx-site.conf` 是一份完整参考，含 gzip 和静态资源长缓存，可以直接对照着搬。

保存后重载：`nginx -t && nginx -s reload`（宝塔里点「重载配置」也行）。

---

## Step 5 · 配每日备份

同机部署时，备份是唯一的容灾手段。

```bash
chmod +x deploy/backup-db.sh
bash deploy/backup-db.sh     # 先手动跑一次，确认能生成文件
```

确认无误后加定时任务：

```bash
crontab -e
# 加这一行
0 3 * * * /bin/bash /www/wwwroot/laroja/deploy/backup-db.sh >> /www/backup/laroja/backup.log 2>&1
```

保留 14 天，脚本里可改。

**强烈建议再加一步异地备份**：用 `ossutil` 或 `rclone` 把 `/www/backup/laroja` 同步到 OSS。本机磁盘挂了，备份和数据库是一起没的。

---

## Step 6 · 验证

1. 浏览器打开站点，首页/赛事/群友/美食/开黑逐个点一遍
2. **登录一次**，确认能登上（验证 AUTH_SECRET）
3. 管理后台能进、能改数据
4. 手机试一次
5. `pm2 logs laroja-site` 看有没有报错
6. 浏览器 Network 面板看 `/api/players` 的 TTFB：应该 **50ms 以内**（现在是 1 秒以上）

**已完成（2026-10-21）**：Neon 已弃用，代码与配置里不再有任何 Neon 引用。
- 本地 `.env.local` 改为走 SSH 隧道连线上库（`npm run db:tunnel`）
- 弃用前数据已归档到 `backups/neon-archive-<日期>.json`（该目录不进 git）
- 剩余动作需要你自己在 Neon 控制台做：**删除项目**，让之前进过 git 历史的旧凭据彻底失效

历史背景：Neon 当年是为了 Vercel 部署引的，迁到阿里云自托管后一直没人清，导致本地开发连的是
一份 77 人的旧副本、线上是 161 人的真库，两边数据对不上。

---

## 回滚

改 Nginx 之前所有步骤都可逆。出问题就把 `proxy_pass` 改回 Vercel 地址，重载，几十秒恢复。

---

## 常见坑

| 现象 | 原因 |
|---|---|
| `npm run build` 被杀 / Killed | 内存不足，加 swap 或调大 `--max-old-space-size` |
| `Node.js version not supported` | 用了 Node 22，CentOS 7 只能 20 |
| `no pg_hba.conf entry` | 忘了 `DATABASE_SSL=off` |
| 登录后刷新掉线 | `AUTH_SECRET` 没沿用原值 |
| 改了数据别的页面看不到 | PM2 开了多实例。必须 `instances: 1` |
| 上传 Excel 报 413 | Nginx `client_max_body_size` 太小 |
| 头像 403 / 空白 | `.cache/` 目录权限，PM2 运行用户要能写 |
| 首屏加载慢但接口很快 | 3Mbps 带宽到顶了，看是否需要升带宽或上 CDN |
| `yum install` 报 404 | CentOS 7 已 EOL，改用宝塔软件商店 |
