#!/usr/bin/env bash
# Phase 1 WS1.3 — generate a self-signed CA + server cert for EMQX TLS (DEV ONLY).
# For production, use certificates from your real CA / internal PKI instead.
set -euo pipefail
cd "$(dirname "$0")"

CN="${1:-localhost}"
DAYS=825

echo "Generating dev CA + server cert (CN=${CN})..."

# CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/C=VN/O=ST4I/CN=AVI-AOI Dev CA" -out ca.crt

# Server key + CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/C=VN/O=ST4I/CN=${CN}" -out server.csr

# Sign server cert with SAN
cat > server.ext <<EOF
subjectAltName = DNS:${CN}, DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "${DAYS}" -sha256 -extfile server.ext

rm -f server.csr server.ext ca.srl
chmod 600 server.key ca.key
echo "Done. Files: ca.crt ca.key server.crt server.key"
echo "App: set UNS_TLS_CA=deploy/emqx/certs/ca.crt"
