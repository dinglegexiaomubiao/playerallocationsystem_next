# 部署与应急手册

> 给所有会碰这台服务器的人。踩坑的完整技术细节在
> [`docs/pitfalls.md`](./pitfalls.md)，这份只讲「怎么做」。
>
> 背景：2026-10-23 一天内出了两次事故 —— 上午被并行开发线覆盖了功能，傍晚部署把
> 整台机器搞到假死 20 分钟。两次都是可预防的，所以有了这份手册。

服务器：`root@47.115.130.170` · 站点目录 `/www/wwwroot/laroja` · PM2 应用 `laroja-site`

---

## 一、部署前必做（30 秒，能挡住两次事故里的第一次）

```bash
# 1) 线上现在跑的是哪个版本
curl -s https://dota.playerallocationsystem.online/api/version

# 2) 最近几次部署的 commit（每次部署都会写 meta.txt）
ssh root@47.115.130.170 'cat /www/wwwroot/laroja-backups/*/meta.txt | grep commit'
```

第 3 项「磁盘测速」**脚本已经自动做了**（见第二节 `[0/5]`），你不用手动跑；想提前确认
可以自己量一次：

```bash
ssh root@47.115.130.170 'dd if=/dev/zero of=/tmp/iotest bs=1M count=200 oflag=direct 2>&1 | tail -1; rm -f /tmp/iotest'
```

判断标准：

| 检查 | 通过 | 不通过怎么办 |
|---|---|---|
| 第 2 步最新 commit | 在**你的**本地 `git cat-file -t <sha>` 里存在 | **有别的线在推，先停手**，弄清对方改了什么再部署 |
| 磁盘写速（脚本自动测） | **≥ 100 MB/s**（正常 220~240） | 脚本会直接拒绝部署。等 30 分钟到几小时额度恢复；应急用 `--force`，但接受整机假死风险 |

---

## 二、正常部署

```bash
./deploy/deploy.sh                # 本地构建校验 + 上传 + 服务器构建
./deploy/deploy.sh --skip-build   # 本地已经 build 过，省掉校验
./deploy/deploy.sh --force        # 跳过磁盘测速（限流时强行部署，风险自负）
```

脚本会自动：**磁盘测速** → 快照 → 打包上传 → 服务器构建（`nice`+`ionice` 降优先级）
→ 校验产物完整性 → 重启 → 健康检查。**任何一步失败都会自动回滚到本次部署前的快照**，
不会留 502 在线上。快照阶段（压缩源码 + 复制产物）同样降优先级。

部署完成后必看两行输出：

```
→ 产物完整（BUILD_ID xxxxx，75 个页面）
✓ 站点返回 200
```

看到「产物不完整」或「站点返回非 200」= 已自动回滚，去查 `/tmp/laroja-build.log`。

---

## 三、三种事故怎么处理

### A. SSH 连不上、线上 HTTP 000，但 ping 通

这是**云盘 I/O 打满导致的整机假死**，不是宕机也不是被攻击。特征是：
`ping 通 4ms` + 端口 22/80 TCP 可连 + 应用层完全无响应。

```bash
ping 47.115.130.170                    # 通
nc -zv 47.115.130.170 22               # 端口可连
curl -m 20 https://dota...online/      # 000 超时
```

**处置：去阿里云控制台重启实例。** 等不来自愈（上次持续 17 分钟没恢复）。

重启后 PM2 会自启，但产物可能是半成品（见事故 B），需要接着做 B 的恢复。

### B. `pm2 list` 显示 online，但 uptime 只有 1s、restarts 飞涨、线上 502

构建被打断留下的 `.next` 是不完整的（没有 `BUILD_ID`、`server/pages` 为空）。

```bash
cd /www/wwwroot/laroja
pm2 stop laroja-site
mv .next .next.broken
cp -a /www/wwwroot/laroja-backups/<最近的时间戳>/.next .next
pm2 restart laroja-site
sleep 5 && pm2 list | grep laroja      # uptime 应持续增长，mem 应上百 MB
```

注意：恢复的是**旧代码的产物**，站点会回到部署前的版本 —— 先救活，再谈上线。

### C. 部署完了发现功能不对，想退回去

```bash
./deploy/rollback.sh                   # 默认回最近一次快照
```

快照在 `/www/wwwroot/laroja-backups/<时间戳>/`：`source.tar.gz`（源码）+ `.next`（产物）
+ `meta.txt`（commit 号）。源码和产物**必须一起用**，只换其中一个会不匹配。

---

## 四、两条开发线的约定（最重要的一条）

2026-10-23 的事故根因：另一条线从 `034408a` 继续开发，连续部署 5 次，把不包含
地图三级与英雄修复的代码推了上去；`deploy.sh` 又会删除「本地已移除的文件」，
于是两个新文件被直接从服务器删掉。

**只要两条线各自往同一台服务器推，任何一方部署都在破坏另一方。**

必须二选一：

1. **单线推送**：只有一条线有部署权，另一条的改动合并过来再统一部署
2. **明确交接**：谁要部署，先在群里说；部署前 `git pull` 对方分支

另外：`git push` 目前不通（`schannel: server closed abruptly`，本地直连 GitHub 被阻断），
所以 GitHub 上永远落后。**这会让分叉风险更高** —— 对方从 GitHub 拉代码拿不到你的提交。
要么尽快修通链路（换 SSH 协议 / 走代理），要么严格按上面两条来。

---

## 五、常用路径

| 用途 | 位置 |
|---|---|
| 站点源码 | `/www/wwwroot/laroja` |
| 部署快照（保留 5 个） | `/www/wwwroot/laroja-backups/<时间戳>/` |
| 环境变量 | `/www/wwwroot/laroja/.env.local`（不在仓库里） |
| PM2 日志 | `/www/wwwroot/laroja/logs/`、`pm2 logs laroja-site` |
| 构建日志 | `/tmp/laroja-build.log` |
| 完整踩坑表 | `docs/pitfalls.md` |

## 六、改完代码的自检

按改动范围选，别只跑一个：

```bash
npm run heroes:check                                    # 英雄名表与官方数据一致
BASE=https://dota.playerallocationsystem.online node scripts/check-map-levels.cjs   # 地图层级/几何 22 项
BASE=https://dota.playerallocationsystem.online node scripts/check-map-panel.cjs    # 地图右栏面板 12 项
node scripts/check-match-ext.cjs                        # 赛事页外链
node scripts/a11y-contrast.cjs / /map /members           # 对比度
```
