#!/usr/bin/env bash
# Apply the tested NRZ feature to the existing /opt/pit-stop service without
# replacing its environment, database, service unit, or other installed files.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Bu komut sudo ile çalıştırılmalı.' >&2; exit 1; }

source_dir=/home/lrx/bots/Pit-Stop
target_dir=/opt/pit-stop
backup_dir=$(mktemp -d /opt/pit-stop-nrz-backup.XXXXXXXX)
chmod 0700 "$backup_dir"
files=(
  src/index.js src/dashboard.js src/commands.js
  src/nrz-command.js src/nrz-leaderboards.js
  public/app.js public/index.html public/layout.css
)
for file in "${files[@]}"; do
  [[ -f "$source_dir/$file" && -d "$target_dir/$(dirname "$file")" ]] || { echo "Dosya eksik: $file" >&2; exit 1; }
  if [[ -f "$target_dir/$file" ]]; then
    mkdir -p "$backup_dir/$(dirname "$file")"
    cp -a "$target_dir/$file" "$backup_dir/$file"
  fi
done

rollback() {
  local status=$?
  trap - ERR
  set +e
  for file in "${files[@]}"; do
    if [[ -f "$backup_dir/$file" ]]; then cp -a "$backup_dir/$file" "$target_dir/$file";
    else rm -f "$target_dir/$file"; fi
  done
  systemctl restart pit-stop.service
  echo "Dağıtım geri alındı. Yedek: $backup_dir" >&2
  exit "$status"
}
trap rollback ERR

for file in "${files[@]}"; do
  mode=0644
  [[ $file == src/dashboard.js ]] && mode=0600
  install -o pitstop -g pitstop -m "$mode" "$source_dir/$file" "$target_dir/$file"
done
systemctl restart pit-stop.service
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet pit-stop.service && curl -fsS --max-time 2 http://127.0.0.1:3000/healthz | grep -q '"status":"ready"'; then
    healthy=1
    break
  fi
  sleep 2
done
[[ $healthy -eq 1 ]]
trap - ERR
echo "Pit-Stop güncellendi. Yedek: $backup_dir"
