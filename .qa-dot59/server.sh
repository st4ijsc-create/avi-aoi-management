#!/bin/sh
# DOT 59 — server dist rieng tren cong 3059 (cam 3000/3001/3008/5173/8080/3047…3058).
# G78: chi giet PID CUA MINH (.qa-dot59/server.pid). TUYET DOI khong dung toi 23980/32584/5192.
#   sh .qa-dot59/server.sh start <tag> | stop
cd /d/SOURCES/_twin_wt || exit 1
case "$1" in
  start)
    T=/d/SOURCES/_twin_wt/.qa-dot59/dist-$2
    PID=$(cat .qa-dot59/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=3059 NODE_ENV=production nohup node "$T/index.js" > .qa-dot59/server-$2.out.log 2> .qa-dot59/server-$2.err.log &
    for i in $(seq 1 90); do netstat -ano | grep -qE ':3059 .*LISTENING' && break; sleep 1; done
    netstat -ano | grep -E ':3059 ' | grep LISTENING | head -1 | awk '{print $5}' > .qa-dot59/server.pid
    sleep 6
    echo "server 3059 (dist-$2): pid=$(cat .qa-dot59/server.pid) /twin=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3059/twin) bundle=$(curl -s http://localhost:3059/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js') luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat .qa-dot59/server.pid 2>/dev/null)
    if [ -n "$PID" ]; then taskkill //PID "$PID" //F; fi
    : > .qa-dot59/server.pid
    sleep 1
    netstat -ano | grep -E ':3059 ' | grep LISTENING || echo "3059 da tat luc $(date -Iseconds)"
    ;;
  *) echo "start <tag> | stop" ;;
esac
