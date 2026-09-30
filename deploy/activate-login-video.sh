#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Bu komut sudo ile çalıştırılmalı.' >&2; exit 1; }
source_dir=/home/lrx/bots/Pit-Stop
target_dir=/opt/pit-stop
files=(
  src/dashboard.js public/app.js public/index.html public/styles.css public/layout.css
  public/login-background.js public/assets/login-tuner.mp4 public/assets/login-tuner-poster.jpg
)
for file in "${files[@]}"; do
  [[ -f "$source_dir/$file" && -d "$target_dir/$(dirname "$file")" ]] || { echo "Dosya eksik: $file" >&2; exit 1; }
done
cd "$source_dir"
sha256sum --quiet -c deploy/login-release.sha256
backup_dir=$(mktemp -d /opt/pit-stop-login-backup.XXXXXXXX)
chmod 0700 "$backup_dir"
for file in "${files[@]}"; do
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
  echo "Güncelleme geri alındı. Yedek: $backup_dir" >&2
  exit "$status"
}
trap rollback ERR
for file in "${files[@]}"; do
  mode=0644
  [[ $file == src/dashboard.js ]] && mode=0600
  install -o pitstop -g pitstop -m "$mode" "$source_dir/$file" "$target_dir/$file"
done
systemctl daemon-reload
systemctl restart pit-stop.service
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet pit-stop.service && curl -fsS --max-time 2 http://127.0.0.1:3000/healthz 2>/dev/null | grep -q '"status":"ready"'; then
    healthy=1
    break
  fi
  sleep 2
done
[[ $healthy -eq 1 ]]
curl -fsS --max-time 5 http://127.0.0.1:3001/ | grep -q 'login-tuner.mp4'
curl -fsS --max-time 5 http://127.0.0.1:3001/login-background.js >/dev/null
curl -fsS --max-time 5 -H 'Range: bytes=0-31' http://127.0.0.1:3001/assets/login-tuner.mp4 -o "$backup_dir/video-check.bin"
[[ $(stat -c %s "$backup_dir/video-check.bin") -eq 32 ]]
trap - ERR
echo "Pit-Stop site ve video güncellemesi başarılı. Yedek: $backup_dir"
