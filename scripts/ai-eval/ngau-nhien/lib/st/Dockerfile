# Ảnh `st-rusty:1.0.7` cho kiểu chấm `st` của bộ NGẪU NHIÊN (Đợt 7.2). Hai tệp .deb là bản phát hành CHÍNH THỨC
# RuSTy 1.0.7 (https://github.com/PLC-lang/rusty/releases) — bản lưu ở D:/SOURCES/16.AI/toolchains/st/dl/rusty-1.0.7/.
# Dựng: docker build -t st-rusty:1.0.7 <thư mục chứa Dockerfile + 2 .deb + run-job.sh>. RuSTy: LGPL-3.0 (dùng như công cụ).
# RuSTy 1.0.7 (release debs, pinned) + gcc làm driver liên kết (libc, crt)
FROM debian:bookworm-slim
COPY plc-compiler_1.0.7-1_amd64.deb plc-stdlib_1.0.7-1_amd64.deb /tmp/
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev coreutils \
 && apt-get install -y /tmp/plc-compiler_1.0.7-1_amd64.deb /tmp/plc-stdlib_1.0.7-1_amd64.deb \
 && rm -rf /var/lib/apt/lists/* /tmp/*.deb \
 && useradd -m -u 1000 st
WORKDIR /w
COPY run-job.sh /usr/local/bin/run-job.sh
RUN chmod 755 /usr/local/bin/run-job.sh
USER st
