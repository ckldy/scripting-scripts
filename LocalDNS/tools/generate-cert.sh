#!/bin/sh
CERT_DIR="/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/cert"
WEB_DIR="/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web"

mkdir -p "$CERT_DIR"
mkdir -p "$WEB_DIR"

echo "=== 重新生成 LocalDNS CA 根证书与 TLS 服务端证书 ==="

# 1. 写入 SAN 配置 (包含 127.0.0.1, localhost, localdns.local)
cat << 'EOF' > "$CERT_DIR/san.cnf"
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localdns.local
O = LocalDNS
C = CN

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = localdns.local
IP.1 = 127.0.0.1
EOF

# 2. 生成全新 CA 根证书 (3650 天有效)
openssl req -x509 -new -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
  -subj "/CN=LocalDNS Root CA/O=LocalDNS/C=CN"

# 3. 生成服务端私钥与证书请求 (CSR)
openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" \
  -config "$CERT_DIR/san.cnf"

# 4. 用 CA 签署服务端证书 (严格 365 天有效，符合 Apple <= 825 天安全限制)
openssl x509 -req -days 365 \
  -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" \
  -extfile "$CERT_DIR/san.cnf" -extensions v3_req

# 5. 导出 PKCS#12 (server.p12, 密码: localdns)
openssl pkcs12 -export \
  -out "$CERT_DIR/server.p12" \
  -inkey "$CERT_DIR/server.key" -in "$CERT_DIR/server.crt" -certfile "$CERT_DIR/ca.crt" \
  -name "localdns" -password pass:localdns \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES

# 6. 同步 ca.crt 至 web 目录供 Safari 一键下载安装
cp "$CERT_DIR/ca.crt" "$WEB_DIR/ca.crt"

echo "=== 证书重新生成成功！==="
openssl x509 -in "$CERT_DIR/server.crt" -noout -dates
