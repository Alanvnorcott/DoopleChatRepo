#!/usr/bin/env bash
# Usage: ./generate-credentials.sh <username> <secret>
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <username> <secret>"
  exit 1
fi
username=$1
secret=$2
ts=$(date +%s)
nonce="${ts}"
hmac=$(printf "%s" "${username}:${nonce}" | openssl dgst -sha1 -hmac "${secret}" -binary | xxd -p -c 256)
echo "username: ${username}"
echo "timestamp: ${nonce}"
echo "hmac: ${hmac}"
