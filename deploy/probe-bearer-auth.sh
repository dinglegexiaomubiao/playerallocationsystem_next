#!/bin/bash
# 会话双通道线上验证（在服务器上跑）
set -u
cd /www/wwwroot/laroja || exit 1

# lib/auth.js 是 ESM 语法放在 .js 里（Next 会编译），Node 直接 import 会被当成 CJS。
# 复制成 .mjs 就能按 ESM 加载，且只依赖 crypto，不碰数据库。
cp lib/auth.js /tmp/auth-copy.mjs

set -a
. ./.env.local
set +a

TOKEN=$(node --input-type=module -e "import('/tmp/auth-copy.mjs').then(m=>{process.stdout.write(m.createToken('dom'))})" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "✗ 无法签发 token（AUTH_SECRET 或 lib/auth.js 加载失败）"
  exit 1
fi
echo "已签发 token（前 24 位）：${TOKEN:0:24}…"

pick_me() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(JSON.stringify(j.me))}catch(e){console.log('非 JSON: '+d.slice(0,80))}})"
}

echo
echo "--- 1) 无凭据（应 bound:false） ---"
curl -s --max-time 15 http://127.0.0.1:3000/api/party | pick_me

echo "--- 2) Bearer 直连 3000（应 bound:true） ---"
curl -s --max-time 15 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/party | pick_me

echo "--- 3) Cookie 老通道（应 bound:true，网页不能坏） ---"
curl -s --max-time 15 -H "Cookie: dd_session=$TOKEN" http://127.0.0.1:3000/api/party | pick_me

echo "--- 4) 坏 Bearer（应 bound:false，且不退回 cookie） ---"
curl -s --max-time 15 -H "Authorization: Bearer 乱写" -H "Cookie: dd_session=$TOKEN" http://127.0.0.1:3000/api/party | pick_me

echo
echo "--- 5) 走公网 Nginx（Authorization 是否被吃掉） ---"
curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" https://dota.playerallocationsystem.online/api/party | pick_me

echo
echo "--- 6) 登录接口回归（不存在的账号应 401 USER_NOT_FOUND） ---"
curl -s --max-time 15 -o /tmp/login-probe.json -w "HTTP %{http_code}\n" \
  -X POST -H 'content-type: application/json' \
  -d '{"username":"__probe_not_exist__","password":"x"}' \
  http://127.0.0.1:3000/api/login
head -c 160 /tmp/login-probe.json; echo

echo
echo "--- 7) 管理员判定（Bearer dom 打一个管理员闸门） ---"
curl -s --max-time 15 -o /dev/null -w "无凭据 HTTP %{http_code} / " \
  -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:3000/api/admin/rename-account
curl -s --max-time 15 -o /dev/null -w "Bearer(dom) HTTP %{http_code}\n" \
  -X POST -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{}' http://127.0.0.1:3000/api/admin/rename-account

rm -f /tmp/auth-copy.mjs /tmp/login-probe.json
