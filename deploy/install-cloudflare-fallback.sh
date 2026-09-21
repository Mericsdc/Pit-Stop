#!/usr/bin/env bash
set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  . /etc/os-release
  printf 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared %s main\n' "${VERSION_CODENAME:-any}" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared
fi

cat > /usr/local/sbin/pit-stop-cloudflare-fallback <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
log=/run/pit-stop-cloudflare-fallback.log
url_file=/run/pit-stop-cloudflare-fallback.url
rm -f "$log" "$url_file"
runuser -u www-data -- cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:3001 >"$log" 2>&1 &
child=$!
trap 'kill "$child" 2>/dev/null || true' EXIT INT TERM

url=''
for _ in $(seq 1 60); do
  url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$log" | tail -n 1 || true)"
  if [ -n "$url" ]; then break; fi
  if ! kill -0 "$child" 2>/dev/null; then cat "$log" >&2; exit 1; fi
  sleep 1
done
[ -n "$url" ] || { cat "$log" >&2; exit 1; }
printf '%s\n' "$url" > "$url_file"
chmod 0644 "$url_file"

python3 - "$url" <<'PY'
import os, sys, tempfile
from pathlib import Path

url = sys.argv[1]
path = Path('/etc/pit-stop/pit-stop.env')
lines = path.read_text(encoding='utf-8').splitlines()
origins = []
output = []
for line in lines:
    if line.startswith('PANEL_ORIGINS='):
        origins.extend(item.strip() for item in line.partition('=')[2].split(',') if item.strip())
    else:
        output.append(line)
origins = [item for item in origins if not item.endswith('.trycloudflare.com')]
origins.append(url)
output.append('PANEL_ORIGINS=' + ','.join(dict.fromkeys(origins)))
fd, temporary = tempfile.mkstemp(prefix='.pit-stop.env.', dir=str(path.parent), text=True)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(output) + '\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY

systemctl restart pit-stop.service
logger -t pit-stop-cloudflare "Cloudflare fallback ready: $url"
wait "$child"
SCRIPT
chmod 0755 /usr/local/sbin/pit-stop-cloudflare-fallback

cat > /etc/systemd/system/pit-stop-cloudflare-fallback.service <<'UNIT'
[Unit]
Description=Pit-Stop Cloudflare HTTPS fallback
After=network-online.target pit-stop.service
Wants=network-online.target pit-stop.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/pit-stop-cloudflare-fallback
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now pit-stop-cloudflare-fallback.service

for _ in $(seq 1 75); do
  if [ -s /run/pit-stop-cloudflare-fallback.url ]; then
    cat /run/pit-stop-cloudflare-fallback.url
    exit 0
  fi
  sleep 1
done
journalctl -u pit-stop-cloudflare-fallback.service -n 80 --no-pager
exit 1
