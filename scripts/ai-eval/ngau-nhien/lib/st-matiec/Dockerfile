# Ảnh `st-openplc-matiec:b5d41356` cho kiểu chấm `st` — trình biên dịch MATIEC (`iec2c`) ĐÚNG BẢN mà OpenPLC v3 của bench
# dùng (OpenPLC_v3 @ b5d41356d, 2026-04-04, lấy từ ảnh `avi-openplc-bench:v3` /workdir/utils/matiec_src) + gcc để biên
# dịch C sinh ra. MATIEC: GPL-3.0 (dùng như công cụ, không phân phối kèm sản phẩm).
# Dựng (cần ảnh bench có sẵn + mạng cho apt): docker build -t st-openplc-matiec:b5d41356 scripts/ai-eval/ngau-nhien/lib/st-matiec
FROM avi-openplc-bench:v3 AS bench
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 st
COPY --from=bench /workdir/utils/matiec_src/iec2c /opt/matiec/iec2c
COPY --from=bench /workdir/utils/matiec_src/lib /opt/matiec/lib
RUN echo "OpenPLC_v3 b5d41356dab4aeadca0dd7ca64ba542f870b595d (matiec_src)" > /opt/matiec/NGUON && chmod 755 /opt/matiec/iec2c
ENV PATH=/opt/matiec:$PATH
WORKDIR /w
USER st
