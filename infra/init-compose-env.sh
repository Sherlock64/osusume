#!/bin/sh
# Generates the Compose stack's secrets into infra/.env, which Compose reads on its own. Keeps an
# existing file: a new AUTH_SECRET signs everyone out, and a new Postgres password no longer
# matches the data volume.
set -eu
env_file="$(dirname "$0")/.env"
if [ -e "$env_file" ]; then
  echo "$env_file already exists; leaving it alone."
  exit 0
fi
umask 077
{
  echo "AUTH_SECRET=$(openssl rand -hex 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
} > "$env_file"
echo "Wrote $env_file."
