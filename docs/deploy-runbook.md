# 部署与应急手册

> 给所有会碰这台服务器的人。踩坑的完整技术细节在
> [`docs/pitfalls.md`](./pitfalls.md)，这份只讲「怎么做」。
>
> **文档里的 `YOUR_SERVER_IP` 是占位符**，执行前换成实际地址 —— 服务器公网地址
> 不写进仓库。同理 `root@YOUR_SERVER_IP` 指登录用的账号与主机。
>
> 背景：2026-10-23 一天内出了两次事故 —— 上午被并行开发线覆盖了功能，傍晚部署把
> 整台机器搞到假死 20 分钟。两次都是可预防的，所以有了这份手册。

服务器：`root@YOUR_SERVER_IP` · 站点目录 `/www/wwwroot/laroja` · PM2 应用 `laroja-site`

---

## 一、部署前必做（30 秒，能挡住两次事故里的第一次）

```bash
# 1) 线上现在跑的是哪个版本
curl -s https://dota.playerallocationsystem.online/api/version

# 2) 最近几次部署的 commit（每次部署都会写 meta.txt）
ssh root@YOUR_SERVER_IP 'cat /www/wwwroot/laroja-backups/*/meta.txt | grep commit'
```

第 3 项「磁盘测速」**脚本已经自动做了**（见第二节 `[0/5]`），你不用手动跑；想提前确认
可以自己量一次：

```bash
ssh root@YOUR_SERVER_IP 'dd if=/dev/zero of=/tmp/iotest bs=1M count=200 oflag=direct 2>&1 | tail -1; rm -f /tmp/iotest'
```

判断标准：

| 检查 | 通过 | 不通过怎么办 |
|---|---|---|
| 第 2 步最新 commit | 在**你的**本地 `git cat-file -t <sha>` 里存在 | **有别的线在推，先停手**，弄清对方改了什么再部署 |
| 磁盘写速（脚本自动测） | **≥ 100 MB/s**（正常 220~240） | 脚本会直接拒绝部署。等 30 分钟到几小时额度恢复；应急用 `--force`，但接受整机假死风险 |

---

## 二、正常部署

```bash
./deploy/deploy.sh                # 默认：本地构建 → 只传约 3M 产物 → 服务器解压并原子切换
./deploy/deploy.sh --skip-build   # 本地已经 build 过，直接用现有 .next 打包
./deploy/deploy.sh --server-build # 回退方案：在服务器上构建（跨平台产物跑不起来时用）
./deploy/deploy.sh --force        # 跳过磁盘测速（限流时强行部署，风险自负）
```

**默认不在这台服务器上构建**，这是 2026-10-23 定的。原因有实测数据：服务器 2 核，
自己 `next build` 要 5.4 分钟，那段时间里 next-server 抢不到 CPU，一次部署产生
28 个 504 + 137 个 499。改成「本地构建、只传 3M 产物」后，构建窗口直接归零，
上传期间线上一个字都不动。

脚本会自动：**磁盘测速** → 快照 → 打包源码与产物 → 上传 → 服务器解压到 `.next-build`
→ 校验 `BUILD_ID` → 修外部模块链接 → `mv` 原子切换 → 重启 → 健康检查。

部署完成后必看这几行：

```
→ 产物已解压（BUILD_ID xxxxx）
→ N 个外部模块链接已指回 node_modules
→ 静态产物 2.6M（含上一版 chunk，旧页面不会 404）
→ 产物已切换
✓ 站点返回 200
```

几个容易误会的点：

- **产物是本地构建的，跨平台会有坑**：Turbopack 把 `pg`/`xlsx`/`nodemailer` 写成
  `<包名>-<哈希>` 虚拟名，并放一个指向**构建机绝对路径**的符号链接（Windows 上是
  `/e/lzf/...`），传到 Linux 就是死链、API 全 500。脚本会自动把它改写成相对链接并
  **逐个验证能解析**，解析不了就中止且「线上未动」。看到「N 个外部模块链接已指回」
  就说明这一步过了。
- **失败不会碰线上**：新产物落在 `.next-build`，校验通过才 `mv` 切换。任何一步失败
  都是「线上未动」，不是「回滚」（回滚只在切换之后健康检查不过时才发生）。
- **旧 chunk 会保留 14 天**：微信/QQ 内置浏览器缓存 HTML 很久，用户手里那页还引用旧
  hash 的 JS。脚本会把上一版 `static` 合并进新产物，否则旧页面会 404 →
  「页面看得见但按钮全按不动」。

---

## 三、三种事故怎么处理

### A. SSH 连不上、线上 HTTP 000，但 ping 通

这是**云盘 I/O 打满导致的整机假死**，不是宕机也不是被攻击。特征是：
`ping 通 4ms` + 端口 22/80 TCP 可连 + 应用层完全无响应。

```bash
ping YOUR_SERVER_IP                    # 通
nc -zv YOUR_SERVER_IP 22               # 端口可连
curl -m 20 https://dota...online/      # 000 超时
```

**处置：去阿里云控制台重启实例。** 等不来自愈（上次持续 17 分钟没恢复）。

改成默认本地构建后，触发概率已经大幅下降（服务器不再跑 build），但快照复制和上传
仍是 I/O，所以 `[0/5]` 会先测速挡住。重启后 PM2 会自启，正常情况直接能用；
如果 502，走事故 B。

### B. `pm2 list` 显示 online，但 uptime 只有 1s、restarts 飞涨、线上 502

切换过去的产物在运行时炸了 —— 最常见是新产物里的外部模块没指回 `node_modules`
（跨平台死链），也可能是缺环境变量、运行时读不到数据表。

**正常情况下不会遇到**：脚本切换前会校验 `BUILD_ID`、把外部链接改写成相对路径并逐个
验证能解析，任何一步不过都是「线上未动」。真遇到了，说明问题出在切换之后：

```bash
cd /www/wwwroot/laroja
pm2 logs laroja-site --lines 50        # 先看真实报错，别猜
```

判断：`Cannot find module 'pg-xxxx'` → 外部模块链接问题，用 `--server-build` 重新部署；
其他运行时报错 → 退回上一版：

```bash
./deploy/rollback.sh                   # 一键退回最近一次快照
```

若已经无法 SSH 或 PM2 完全失控，手工兜底：

```bash
cd /www/wwwroot/laroja
pm2 stop laroja-site
mv .next .next.broken
cp -a /www/wwwroot/laroja-backups/<最近的时间戳>/.next .next
pm2 restart laroja-site
sleep 5 && pm2 list | grep laroja      # uptime 应持续增长，mem 应上百 MB
```

注意：恢复的是**旧代码的产物**，站点会回到部署前的版本 —— 先救活，再谈上线。

⚠ 还有一种情况要会区分：**整个 `.next` 不存在或没有 `BUILD_ID`**（服务器断电打断了
`mv` 切换）→ 说明不是运行时错误而是产物缺失，直接用上面这段手工恢复。

### C. 部署完了发现功能不对，想退回去

```bash
./deploy/rollback.sh                   # 默认回最近一次快照
```

快照在 `/www/wwwroot/laroja-backups/<时间戳>/`：`source.tar.gz`（源码）+ `.next`（产物）
+ `meta.txt`（commit 号）。源码和产物**必须一起用**，只换其中一个会不匹配。

---

## 四、两条开发线的约定（最重要的一条）

2026-10-23 的教训：两条线从同一个提交分叉，各自连续部署，把对方的新功能覆盖了
（`deploy.sh` 还会删除「本地已移除的文件」，所以新加的文件会被直接删掉）。
双方都没有恶意，纯粹是各自不知道对方在改什么 —— 但结果一样严重：地图三级和英雄译名
修复消失，线上看起来「代码自己丢了」。

**现状**：已经合并回一条线（`d71d0e2`），对方的真实提交历史拿到了，`git push` 也通了。
从那以后按这三条来，就不会重演：

1. **动手前先 `git pull`** —— 别在分叉上开发，分叉是一切麻烦的起点
2. **部署前先 `git push`** —— 让线上跑的版本在 GitHub 上一定能找到，出问题别人能查
3. **谁部署先说一声** —— 避免两个人同时推，后者会覆盖前者

补充：`git push` 走的是 HTTPS，之前会因为 `schannel: server closed abruptly` 失败
（本地直连 GitHub 被阻断），重试或换网络即可恢复，不是凭据问题。

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
