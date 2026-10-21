# Nginx 配置（服务器侧）

这些文件**不随** `deploy/deploy.sh` 上线，改动后手动同步：

```bash
scp deploy/nginx/laroja root@47.115.130.170:/etc/nginx/sites-available/laroja
scp deploy/nginx/laroja-proxy.conf deploy/nginx/laroja-sec-headers.conf \
    root@47.115.130.170:/etc/nginx/snippets/
ssh root@47.115.130.170 'nginx -t && systemctl reload nginx'
```

（`/etc/nginx/sites-enabled/laroja` 是指向 `sites-available/laroja` 的软链接，改 available 即可。）

## 为什么搬进仓库

2026-10-21 那次「手机能打开页面、但一条数据都取不到」的根因就在
`laroja-proxy.conf`：HTML 响应没有 `Cache-Control`，浏览器走启发式缓存，
手机端长期抱着旧页面；而每次部署都会重建 `.next`，旧页面引用的
`_next/static/<旧buildId>/*.js` 变成 404 → React 不 hydrate → 页面只剩骨架，
一个数据请求都发不出去。

配置只存在服务器上时，这类问题没有历史可查，换台机器重装还会丢。

## 三条不能动的约定

1. **`location /` 必须带 `Cache-Control: no-cache`**。HTML 一旦可以被缓存，
   每次部署都会把还开着页面的用户打成「白有骨架」。
   静态资源相反：`/_next/static/` 是内容哈希命名，可以 `immutable` 存一年。
2. **任何写了 `add_header` 的 location 都要 `include laroja-sec-headers.conf`**。
   Nginx 的 `add_header` 是「子级有则父级全丢」，漏了就会静默丢掉 CSP / HSTS。
3. **加了 `add_header Cache-Control` 之前先 `proxy_hide_header Cache-Control`**，
   否则 Next 自己发的那个会留下来，变成两个同名头。
