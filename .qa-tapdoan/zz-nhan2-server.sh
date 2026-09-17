#!/bin/sh
# NHÃN-CÒN-LẠI — server ĐO RIÊNG, cổng 3067, pid file RIÊNG.
# Không đụng .qa-tapdoan/server.pid và không giết PID nào ngoài PID của chính mình.
cd /d/SOURCES/avi-aoi-management || exit 1
D=.qa-tapdoan
CONG=3067
PIDF=$D/zz-nhan2-server.pid
case "$1" in
  start)
    T=/d/SOURCES/avi-aoi-management/$D/dist-$2
    [ -f "$T/index.js" ] || { echo "không có $T/index.js"; exit 1; }
    PID=$(cat $PIDF 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F >/dev/null 2>&1
    sleep 1
    PORT=$CONG NODE_ENV=production RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000 \
      nohup node "$T/index.js" > $D/zz-nhan2-server-$2.out.log 2> $D/zz-nhan2-server-$2.err.log &
    for i in $(seq 1 90); do netstat -ano | grep -qE "0.0.0.0:$CONG .*LISTENING" && break; sleep 1; done
    netstat -ano | grep -E "0.0.0.0:$CONG " | grep LISTENING | head -1 | awk '{print $5}' > $PIDF
    sleep 6
    echo "server $CONG (dist-$2): pid=$(cat $PIDF) http=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$CONG/) bundle=$(curl -s http://localhost:$CONG/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js') luc=$(date -Iseconds)"
    ;;
  stop)
    PID=$(cat $PIDF 2>/dev/null)
    [ -n "$PID" ] && taskkill //PID "$PID" //F && echo "đã dừng pid=$PID"
    : > $PIDF
    ;;
  status)
    echo "pid=$(cat $PIDF 2>/dev/null) nghe=$(netstat -ano | grep -E "0.0.0.0:$CONG " | grep -c LISTENING) http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:$CONG/) bundle=$(curl -s --max-time 5 http://localhost:$CONG/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js')"
    ;;
esac
