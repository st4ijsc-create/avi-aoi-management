#!/bin/sh
# DOT 61 — server dist rieng tren cong 3061 (cam 3000/3001/3008/5173/8080/3047…3060).
# G78: chi giet PID CUA MINH (.qa-dot61/server.pid). TUYET DOI khong dung toi 14228 (3001) / 29676 (3008).
#   sh .qa-dot61/server.sh start <tag> | stop
cd /d/SOURCES/_twin_wt || exit 1
case "$1" in
  start)
    T=/d/SOURCES/_twin_wt/.qa-dot61/dist-$2
    PID=$(cat .qa-dot61/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=3061 NODE_ENV=production RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000 nohup node "$T/index.js" > .qa-dot61/server-$2.out.log 2> .qa-dot61/server-$2.err.log &
    for i in $(seq 1 90); do netstat -ano | grep -qE ':3061 .*LISTENING' && break; sleep 1; done
    netstat -ano | grep -E ':3061 ' | grep LISTENING | head -1 | awk '{print $5}' > .qa-dot61/server.pid
    sleep 6
    echo "server 3061 (dist-$2): pid=$(cat .qa-dot61/server.pid) /twin=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3061/twin) bundle=$(curl -s http://localhost:3061/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js') luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat .qa-dot61/server.pid 2>/dev/null)
    if [ -n "$PID" ]; then taskkill //PID "$PID" //F; fi
    : > .qa-dot61/server.pid
    sleep 1
    netstat -ano | grep -E ':3061 ' | grep LISTENING || echo "3061 da tat luc $(date -Iseconds)"
    ;;
  *) echo "start <tag> | stop" ;;
esac
