#!/usr/bin/env bash
# Usage: sudo bash deploy/install.sh /absolute/path/to/pit-stop
# Prerequisites: Linux with systemd, system-wide Node.js 24 and npm,
# and standard util-linux tools (flock, runuser). No public port is needed.
# Configuration: /etc/pit-stop/pit-stop.env (root-only, never copied from git).
# Successful releases and the previous release are retained under /opt/pit-stop.
set -Eeuo pipefail
umask 022

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail 'Run this installer with sudo.'
[[ $# -eq 1 ]] || fail 'Usage: sudo bash deploy/install.sh /absolute/path/to/pit-stop'
source_dir=$(cd -- "$1" && pwd -P)
for required in package.json package-lock.json src/index.js src/config.js deploy/pit-stop.service; do
  [[ -f "$source_dir/$required" ]] || fail "Missing source file: $required"
done
for command in systemctl flock runuser useradd getent node npm; do
  command -v "$command" >/dev/null || fail "Missing prerequisite: $command"
done
[[ -d /run/systemd/system ]] || fail 'This host must be running systemd.'
exec 9>/run/lock/pit-stop-deploy.lock
flock -n 9 || fail 'Another Pit-Stop deployment is in progress.'

if ! getent passwd pit-stop >/dev/null; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin pit-stop
fi
[[ $(id -u pit-stop) -ne 0 ]] || fail 'The pit-stop user must not be root.'
getent group pit-stop >/dev/null || fail 'The pit-stop group is missing.'
runtime_path=/usr/local/bin:/usr/bin:/bin
runuser -u pit-stop -- env PATH="$runtime_path" node -e \
  'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)' \
  || fail 'Install Node.js 24 system-wide in /usr/local/bin or /usr/bin.'
runuser -u pit-stop -- env PATH="$runtime_path" npm --version >/dev/null \
  || fail 'Install npm system-wide alongside Node.js.'

config_file=/etc/pit-stop/pit-stop.env
install -d -o root -g root -m 0700 /etc/pit-stop
if [[ ! -e "$config_file" ]]; then
  if [[ -f "$source_dir/.env.example" ]]; then
    install -o root -g root -m 0600 "$source_dir/.env.example" "$config_file"
  else
    cat > "$config_file" <<'ENV'
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
# Set a guild ID for commands limited to your test server; leave empty for global commands.
DISCORD_GUILD_ID=
HEALTH_PORT=3000
ENV
  fi
  PATH="$runtime_path" node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const template = fs.readFileSync(file, "utf8").replace(/^DATA_DIR=.*(?:\r?\n|$)/gm, "");
    fs.writeFileSync(file, template.trimEnd() + "\nDATA_DIR=/var/lib/pit-stop\n");
  ' "$config_file"
fi
chown root:root "$config_file"
chmod 0600 "$config_file"
# Parse dotenv without executing it as shell code. Do not print credentials.
health_port=$(env -i PATH="$runtime_path" node --env-file="$config_file" --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const token = (process.env.DISCORD_TOKEN || "").trim();
  const clientId = (process.env.DISCORD_CLIENT_ID || "").trim();
  const guildId = (process.env.DISCORD_GUILD_ID || "").trim();
  const port = Number(process.env.HEALTH_PORT || 3000);
  const dataDir = (process.env.DATA_DIR || "/var/lib/pit-stop").trim();
  const validId = id => /^\d{17,20}$/.test(id) && BigInt(id) > 0n && BigInt(id) <= 18446744073709551615n;
  if (!token || /^(your[_ -]|replace|paste[_ -]|changeme|buraya|token_here|<)/i.test(token)
      || !validId(clientId) || (guildId && !validId(guildId))
      || !Number.isInteger(port) || port < 1 || port > 65535
      || dataDir !== "/var/lib/pit-stop") process.exit(1);
  try {
    const { readConfig } = await import(pathToFileURL(process.argv[1]).href);
    readConfig({ ...process.env, DATA_DIR: dataDir });
  } catch { process.exit(1); }
  process.stdout.write(String(port));
  ' "$source_dir/src/config.js") || fail "Check $config_file: valid DISCORD_TOKEN and DISCORD_CLIENT_ID are required; DATA_DIR must be /var/lib/pit-stop. The service has not been changed."

app_root=/opt/pit-stop
release_root="$app_root/releases"
current_link="$app_root/current"
unit_path=/etc/systemd/system/pit-stop.service
install -d -o root -g root -m 0755 "$app_root" "$release_root"
[[ ! -e "$current_link" || -L "$current_link" ]] || fail "$current_link must be a symlink."
previous_release=
if [[ -L "$current_link" ]]; then
  previous_release=$(readlink -f -- "$current_link")
  [[ "$previous_release" == "$release_root/"* && -d "$previous_release" ]] \
    || fail 'The current release points outside the managed releases directory or is missing.'
fi
was_active=0
if systemctl is-active --quiet pit-stop.service; then was_active=1; fi
release_dir=$(mktemp -d "$release_root/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 0755 "$release_dir"
cp -- "$source_dir/package.json" "$source_dir/package-lock.json" "$release_dir/"
cp -R -- "$source_dir/src" "$release_dir/src"
for runtime_dir in public scripts; do
  [[ ! -d "$source_dir/$runtime_dir" ]] || cp -R -- "$source_dir/$runtime_dir" "$release_dir/$runtime_dir"
done
if [[ -d "$source_dir/assets" ]]; then cp -R -- "$source_dir/assets" "$release_dir/assets"; fi
chown -R pit-stop:pit-stop "$release_dir"
# Install before stopping the running bot; lifecycle scripts run without root privileges.
(cd -- "$release_dir" && runuser -u pit-stop -- env PATH="$runtime_path" \
  HOME="$release_dir" npm ci --omit=dev --no-audit --no-fund --cache="$release_dir/.npm-cache")
chown -R root:root "$release_dir"
chmod -R go-w "$release_dir"
had_unit=0
if [[ -f "$unit_path" ]]; then
  cp -- "$unit_path" "$release_dir/previous-pit-stop.service"
  had_unit=1
fi

rollback() {
  local status=$?
  trap - ERR
  set +e
  printf 'Deployment failed; restoring the previous service and release.\n' >&2
  systemctl stop pit-stop.service >/dev/null 2>&1
  if [[ -n "$previous_release" ]]; then
    ln -sfn -- "$previous_release" "$app_root/.current-next"
    mv -Tf -- "$app_root/.current-next" "$current_link"
  elif [[ -L "$current_link" ]]; then
    unlink -- "$current_link"
  fi
  if [[ $had_unit -eq 1 ]]; then
    install -o root -g root -m 0644 "$release_dir/previous-pit-stop.service" "$unit_path"
  else
    rm -f -- "$unit_path"
  fi
  systemctl daemon-reload
  if [[ $was_active -eq 1 ]]; then systemctl reset-failed pit-stop.service; systemctl start pit-stop.service; fi
  printf 'Inspect logs with: sudo journalctl -u pit-stop.service -n 100\n' >&2
  exit "${status:-1}"
}
trap rollback ERR
if systemctl cat pit-stop.service >/dev/null 2>&1; then systemctl stop pit-stop.service; fi
install -o root -g root -m 0644 "$source_dir/deploy/pit-stop.service" "$unit_path"
ln -sfn -- "$release_dir" "$app_root/.current-next"
mv -Tf -- "$app_root/.current-next" "$current_link"
systemctl daemon-reload
systemctl reset-failed pit-stop.service 2>/dev/null || true
systemctl start pit-stop.service

healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet pit-stop.service && PATH="$runtime_path" node -e \
    'fetch("http://127.0.0.1:" + process.argv[1] + "/healthz", {signal: AbortSignal.timeout(1500)}).then(async r => {const body = await r.json(); process.exit(r.ok && body.name === "Pit-Stop" && body.status === "ready" ? 0 : 1);}).catch(() => process.exit(1))' \
    "$health_port"; then
    healthy=1
    break
  fi
  sleep 2
done
[[ $healthy -eq 1 ]]
systemctl enable pit-stop.service
trap - ERR
printf 'Pit-Stop is ready. Release: %s\n' "$release_dir"
printf 'Logs: sudo journalctl -u pit-stop.service -f\n'
