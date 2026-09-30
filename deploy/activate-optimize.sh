#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Bu komut sudo ile çalıştırılmalı.' >&2; exit 1; }
source_dir=/home/lrx/bots/Pit-Stop
target_dir=/opt/pit-stop
files=(
  src/index.js src/dashboard.js src/static-assets.js src/store.js src/commands.js
  scripts/check.js scripts/register-commands.js README.md
  public/app.js public/index.html public/styles.css public/layout.css public/assets/login-tuner.mp4
  tests/dashboard.test.js tests/retired-feature.test.js tests/static-assets.test.js deploy/remove-rpg.mjs
)
removed=(
  src/rpg.js src/rpg-system.js src/rpg-social.js src/rpg-garage.js src/rpg-vehicles.js
  public/rpg-view.js public/rpg-vehicles-view.js public/rpg-garage-scene.js public/rpg-garage-interactive.js
  public/assets/rpg
  tests/rpg.test.js tests/rpg-web.test.js tests/rpg-vehicles.test.js tests/rpg-garage.test.js
  tests/rpg-view.test.js tests/rpg-expansion.test.js tests/rpg-garage-scene.test.js
)
cd "$source_dir"
sha256sum --quiet -c deploy/optimize-release.sha256
for file in "${files[@]}"; do [[ -f "$source_dir/$file" ]] || exit 1; done
backup_dir=$(mktemp -d /opt/pit-stop-optimize-backup.XXXXXXXX)
chmod 0700 "$backup_dir"
for file in "${files[@]}" "${removed[@]}"; do
  if [[ -e "$target_dir/$file" ]]; then
    mkdir -p "$backup_dir/$(dirname "$file")"
    cp -a "$target_dir/$file" "$backup_dir/$file"
  fi
done
rollback() {
  local status=$?
  trap - ERR
  set +e
  systemctl stop pit-stop.service
  for file in "${files[@]}" "${removed[@]}"; do
    rm -rf "$target_dir/$file"
    if [[ -e "$backup_dir/$file" ]]; then cp -a "$backup_dir/$file" "$target_dir/$file"; fi
  done
  if [[ -f "$backup_dir/database.json" ]]; then
    cd "$target_dir"
    /usr/bin/node --env-file=.env "$source_dir/deploy/remove-rpg.mjs" restore "$backup_dir"
  fi
  systemctl restart pit-stop.service
  echo "Güncelleme geri alındı. Yedek: $backup_dir" >&2
  exit "$status"
}
trap rollback ERR
systemctl stop pit-stop.service
cd "$target_dir"
/usr/bin/node --env-file=.env "$source_dir/deploy/remove-rpg.mjs" remove "$backup_dir"
for file in "${files[@]}"; do
  mkdir -p "$target_dir/$(dirname "$file")"
  mode=0644
  [[ $file == src/dashboard.js ]] && mode=0600
  install -o pitstop -g pitstop -m "$mode" "$source_dir/$file" "$target_dir/$file"
done
for file in "${removed[@]}"; do rm -rf "$target_dir/$file"; done
systemctl restart pit-stop.service
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet pit-stop.service && curl -fsS --max-time 2 http://127.0.0.1:3000/healthz 2>/dev/null | grep -q '"status":"ready"'; then healthy=1; break; fi
  sleep 2
done
[[ $healthy -eq 1 ]]
curl -fsS --max-time 5 http://127.0.0.1:3001/ -o "$backup_dir/index-check.html"
grep -q 'login-tuner.mp4?v=2' "$backup_dir/index-check.html"
! grep -q 'Mini RPG' "$backup_dir/index-check.html"
curl -fsS --max-time 5 -H 'Range: bytes=0-31' http://127.0.0.1:3001/assets/login-tuner.mp4 -o "$backup_dir/video-check.bin"
[[ $(stat -c %s "$backup_dir/video-check.bin") -eq 32 ]]
[[ $(curl -s --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/me) == 401 ]]
trap - ERR
echo "Cam giriş ekranı ve optimizasyon uygulandı; RPG sistemi kaldırıldı. Yedek: $backup_dir"
