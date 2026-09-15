#!/bin/sh
# QA lần 11 — server dist riêng cổng 3064 (cấm 3000/3001/3008/5173/8080/3047-3063). G78: chỉ giết PID CỦA MÌNH.
cd /d/SOURCES/avi-aoi-management || exit 1
D=.qa-tapdoan
case "$1" in
  start)
    T=/d/SOURCES/avi-aoi-management/$D/dist-$2
    [ -f "$T/index.js" ] || { echo "không có $T/index.js"; exit 1; }
    PID=$(cat $D/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=3064 NODE_ENV=production RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000 \
      nohup node "$T/index.js" > $D/server-$2.out.log 2> $D/server-$2.err.log &
    for i in $(seq 1 90); do netstat -ano | grep -qE ':3064 .*LISTENING' && break; sleep 1; done
    netstat -ano | grep -E ':3064 ' | grep LISTENING | head -1 | awk '{print $5}' > $D/server.pid
    sleep 6
    echo "server 3064 (dist-$2): pid=$(cat $D/server.pid) /twin=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3064/twin) bundle=$(curl -s http://localhost:3064/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js') luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat $D/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F && echo "đã dừng pid=$PID"
    : > $D/server.pid
    ;;
  status)
    echo "pid=$(cat $D/server.pid 2>/dev/null) nghe=$(netstat -ano | grep -E ':3064 ' | grep -c LISTENING) http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3064/)"
    ;;
esac
