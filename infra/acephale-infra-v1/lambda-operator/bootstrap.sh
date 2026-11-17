#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
here="$(cd -- "$(dirname -- "$0")" && pwd -P)"
config="${1:?Pass the operator configuration JSON}"
[[ "$(id -un)" == ubuntu ]]
unset OPENAI_API_KEY LAMBDA_API_KEY HF_TOKEN HUGGING_FACE_HUB_TOKEN
python3 "$here/bootstrap.py" --config "$config" --validate-only
# Install only missing host prerequisites. This is a newly leased research host.
missing=()
command -v git >/dev/null || missing+=(git)
command -v curl >/dev/null || missing+=(curl)
command -v setfacl >/dev/null || missing+=(acl)
command -v socat >/dev/null || missing+=(socat)
command -v docker >/dev/null || missing+=(docker.io docker-compose-v2)
python3 -c 'import venv, ensurepip' 2>/dev/null || missing+=(python3-venv)
if ((${#missing[@]})); then
  sudo -n timeout 180 apt-get update > "$here/prerequisites.log" 2>&1
  sudo -n timeout 180 apt-get install -y --no-install-recommends "${missing[@]}" >> "$here/prerequisites.log" 2>&1
fi
sudo -n systemctl start docker
getent group docker >/dev/null
sudo -n usermod -aG docker ubuntu
# A new primary-group process gets Docker access immediately, without reconnecting.
exec sudo -n -u ubuntu -g docker -- python3 "$here/bootstrap.py" --config "$config"
