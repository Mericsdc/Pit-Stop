#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Bu komut sudo ile çalıştırılmalı.' >&2; exit 1; }
source_dir=/home/lrx/bots/Pit-Stop
target_dir=/opt/pit-stop
files=(src/music.js src/dashboard.js public/app.js public/layout.css public/assets/panel-dm-sans.ttf public/assets/panel-inter-bold.ttf scripts/check-panel-music.mjs)
cd "$source_dir"
sha256sum --quiet -c deploy/panel-theme-release.sha256
# Preserve intervening production edits; the music baseline includes the existing
# live SoundCloud changes that had not yet been copied back into Git.
if ! (cd "$target_dir" && sha256sum --quiet -c "$source_dir/deploy/panel-theme-live-before.sha256"); then
  echo 'Canlı dosyalar hazırlık sonrasında değişmiş; üzerine yazılmadı.' >&2
  exit 1
fi
backup_dir=$(mktemp -d /opt/pit-stop-panel-theme-backup.XXXXXXXX)
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
    rm -f "$target_dir/$file.pending"
  done
  systemctl restart pit-stop.service
  echo "Güncelleme geri alındı. Yedek: $backup_dir" >&2
  exit "$status"
}
trap rollback ERR
for file in "${files[@]}"; do
  mode=0644
  [[ $file == src/* ]] && mode=0600
  install -o pitstop -g pitstop -m "$mode" "$source_dir/$file" "$target_dir/$file.pending"
  mv -f "$target_dir/$file.pending" "$target_dir/$file"
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
for file in layout.css app.js assets/panel-dm-sans.ttf assets/panel-inter-bold.ttf; do
  curl -fsSI --max-time 5 "http://127.0.0.1:3001/$file" >/dev/null
done
# The login markup, existing styles and original video must remain byte-identical.
(cd "$target_dir" && sha256sum --quiet -c "$source_dir/deploy/panel-theme-login.sha256")
cd "$target_dir"
timeout 30 runuser -u pitstop -- /usr/bin/node --env-file=.env scripts/check-panel-music.mjs
trap - ERR
echo "Liquid glass panel teması ve panel müzik düzeltmesi uygulandı."
echo "Giriş ekranı ve özgün video korundu. Yedek: $backup_dir"
