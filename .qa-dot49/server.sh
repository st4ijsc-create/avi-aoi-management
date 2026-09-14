#!/bin/sh
# ĐỢT 49 — server dist trên cổng 3049 (cấm 3000/3001/3008/5173/8080/3047/3048). G78: chỉ giết PID của mình.
#   sh .qa-dot49/server.sh start <tag> | stop
cd /d/SOURCES/_twin_wt || exit 1
case "$1" in
  start)
    PID=$(cat .qa-dot49/server.pid 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=3049 NODE_ENV=production nohup node .qa-dot49/dist-$2/index.js > ".qa-dot49/server-$2.out.log" 2> ".qa-dot49/server-$2.err.log" &
    for i in $(seq 1 90); do netstat -ano | grep -qE ':3049 .*LISTENING' && break; sleep 1; done
    netstat -ano | grep -E ':3049 ' | grep LISTENING | head -1 | awk '{print $5}' > .qa-dot49/server.pid
    sleep 8
    echo "server $2: pid=$(cat .qa-dot49/server.pid) http=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3049/twin) luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat .qa-dot49/server.pid 2>/dev/null)
    if [ -n "$PID" ]; then taskkill //PID "$PID" //F; fi
    : > .qa-dot49/server.pid
    sleep 1
    netstat -ano | grep -E ':3049 ' | grep LISTENING || echo "3049 da tat luc $(date -Iseconds)"
    ;;
  *) echo "start <tag> | stop" ;;
esac
