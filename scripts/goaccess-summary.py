#!/usr/bin/env python3
# 读取 GoAccess 的 JSON 输出，打印一份精简摘要。
#
# 用法：
#   goaccess /var/log/nginx/access.log --log-format=COMBINED \
#       --ignore-crawlers --anonymize-ip --no-global-config -o /tmp/r.json
#   python3 scripts/goaccess-summary.py /tmp/r.json
#
# 说明：goaccess 的 JSON 里每个统计项的 data/count 往往是 {"count":n,"percent":"x%"} 结构，
# 这里统一取 count 值再输出。
import json
import sys


def num(v):
    """统计值可能是数字，也可能是 {'count': n, 'percent': 'x%'} 结构"""
    if isinstance(v, dict):
        return v.get('count', 0)
    return v


def pct(v):
    if isinstance(v, dict):
        return v.get('percent', '')
    return ''


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/r.json'
    d = json.load(open(path, encoding='utf-8'))
    g = d.get('general', {})

    print('=== 总体指标 ===')
    for key, label in [
        ('total_requests', '总请求数'),
        ('valid_requests', '有效请求'),
        ('failed_requests', '失败请求'),
        ('unique_visitors', '独立访客'),
        ('unique_files', '不同文件'),
        ('unique_not_found', '404 地址数'),
        ('bandwidth', '总流量'),
    ]:
        v = g.get(key)
        if key == 'bandwidth' and isinstance(v, (int, float)):
            print('  %-12s %.1f MB' % (label, v / 1048576))
        else:
            print('  %-12s %s' % (label, v))

    def section(title, key, limit=10, unit='次'):
        rows = d.get(key, {}).get('data', [])
        if not rows:
            return
        print()
        print('=== %s ===' % title)
        for row in rows[:limit]:
            label = row.get('data')
            if isinstance(label, dict):
                label = label.get('count', label)
            print('  %6s %-4s %s' % (num(row.get('hits')), unit, label))

    section('访问量最高的路径', 'requests', 10)
    section('状态码分布', 'status_codes', 8)
    section('浏览器占比', 'browsers', 5)
    section('访客 IP（已匿名化）', 'hosts', 8)

    # 时段分布单独排一下，看得更直观
    vt = d.get('visit_time', {}).get('data', [])
    if vt:
        print()
        print('=== 按小时分布 ===')
        for row in sorted(vt, key=lambda r: str(r.get('data')))[:24]:
            label = row.get('data')
            if isinstance(label, dict):
                label = label.get('count', label)
            print('  %6s 次   %s' % (num(row.get('hits')), label))


if __name__ == '__main__':
    main()
