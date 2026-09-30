#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Bu komut sudo ile çalıştırılmalı.' >&2; exit 1; }
source_dir=/home/lrx/bots/Pit-Stop
target_dir=/opt/pit-stop
new_video=public/assets/login-tuner-native.webm
old_video=public/assets/login-tuner.mp4
files=(src/dashboard.js public/app.js public/index.html "$new_video")
cd "$source_dir"
sha256sum --quiet -c deploy/native-video-release.sha256
for file in "${files[@]}"; do
  [[ -f "$source_dir/$file" && -d "$target_dir/$(dirname "$file")" ]]
done
backup_dir=$(mktemp -d /opt/pit-stop-native-video-backup.XXXXXXXX)
chmod 0700 "$backup_dir"
for file in "${files[@]}" "$old_video"; do
  if [[ -f "$target_dir/$file" ]]; then
    mkdir -p "$backup_dir/$(dirname "$file")"
    cp -a "$target_dir/$file" "$backup_dir/$file"
  fi
done
rollback() {
  local status=$?
  trap - ERR
  set +e
  for file in "${files[@]}" "$old_video"; do
    if [[ -f "$backup_dir/$file" ]]; then cp -a "$backup_dir/$file" "$target_dir/$file";
    else rm -f "$target_dir/$file"; fi
  done
  systemctl restart pit-stop.service
  echo "Güncelleme geri alındı. Yedek: $backup_dir" >&2
  exit "$status"
}
trap rollback ERR
# Install the media atomically before publishing its URL.
install -o pitstop -g pitstop -m 0644 "$source_dir/$new_video" "$target_dir/$new_video.pending"
mv -f "$target_dir/$new_video.pending" "$target_dir/$new_video"
for file in src/dashboard.js public/app.js public/index.html; do
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
curl -fsS --max-time 5 http://127.0.0.1:3001/ -o "$backup_dir/index-check.html"
grep -q 'login-tuner-native.webm' "$backup_dir/index-check.html"
curl -fsSI --max-time 5 http://127.0.0.1:3001/assets/login-tuner-native.webm -o "$backup_dir/video-headers.txt"
grep -qi 'Content-Type: video/webm' "$backup_dir/video-headers.txt"
curl -fsS --max-time 5 -H 'Range: bytes=0-31' http://127.0.0.1:3001/assets/login-tuner-native.webm -o "$backup_dir/native-check.bin"
[[ $(stat -c %s "$backup_dir/native-check.bin") -eq 32 ]]
cmp -s "$source_dir/$new_video" "$target_dir/$new_video"
old_status=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/assets/login-tuner.mp4)
[[ $old_status != 200 && $old_status != 206 && $old_status != 000 ]]
# Successful deployment: remove only obsolete Pit-Stop login media, including
# media copies in previous deployment backups. Keep databases and code backups.
removed=0
while IFS= read -r -d '' file; do
  rm -f -- "$file"
  removed=$((removed + 1))
done < <(find "$target_dir/public/assets" -maxdepth 1 -type f -name 'login-tuner.mp4' -print0)
for dir in /opt/pit-stop-*-backup.*; do
  [[ -d "$dir" && ! -L "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    rm -f -- "$file"
    removed=$((removed + 1))
  done < <(find "$dir" -type f \( -name 'login-tuner.mp4' -o -name 'video-check.bin' \) -print0)
done
for dir in "$source_dir/site-dist/assets" "$target_dir/site-dist/assets"; do
  [[ -d "$dir" ]] || continue
  rm -f -- "$dir/login-tuner.mp4"
done
trap - ERR
echo "Özgün video uygulandı: 2560×1080, 60 FPS; yeniden sıkıştırma yok."
echo "Eski video dosyaları kaldırıldı: $removed. Kod yedeği: $backup_dir"
