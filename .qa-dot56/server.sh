#!/bin/sh
# DOT 56 — server dist MOI tren cong 3056 (cam 3000/3001/3008/5173/8080/3047…3055).
# G78: chi giet PID CUA MINH (.qa-dot56/server.pid). TUYET DOI khong dung toi 37128/38472.
#   sh .qa-dot56/server.sh start | stop
cd /d/SOURCES/_twin_wt || exit 1
case "$1" in
  start)
    PID=$(cat .qa-dot56/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=3056 NODE_ENV=production nohup node dist/index.js > .qa-dot56/server.out.log 2> .qa-dot56/server.err.log &
    for i in $(seq 1 90); do netstat -ano | grep -qE ':3056 .*LISTENING' && break; sleep 1; done
    netstat -ano | grep -E ':3056 ' | grep LISTENING | head -1 | awk '{print $5}' > .qa-dot56/server.pid
    sleep 8
    echo "server 3056: pid=$(cat .qa-dot56/server.pid) /twin=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3056/twin) luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat .qa-dot56/server.pid 2>/dev/null)
    if [ -n "$PID" ]; then taskkill //PID "$PID" //F; fi
    : > .qa-dot56/server.pid
    sleep 1
    netstat -ano | grep -E ':3056 ' | grep LISTENING || echo "3056 da tat luc $(date -Iseconds)"
    ;;
  *) echo "start | stop" ;;
esac
