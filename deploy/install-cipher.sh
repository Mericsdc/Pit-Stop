#!/usr/bin/env bash
set -euo pipefail
# Ubuntu x86_64. Install only official pinned sources; credentials stay on the host.
[[ $(id -u) == 0 && $(uname -m) == x86_64 ]] || { echo 'Run as root on x86_64 Linux.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
archive=$(mktemp /tmp/pit-stop-deno.XXXXXX.zip)
trap 'rm -f -- "$archive"' EXIT
curl --fail --location --silent --show-error https://github.com/denoland/deno/releases/download/v2.9.6/deno-x86_64-unknown-linux-gnu.zip -o "$archive"
echo "394f07f4da2bebe6ce6f1e7ce0fa16429b29b08c35e3fac3fe25972676dff4b2  $archive" | sha256sum --check --status
install -d -m 755 /opt/pit-stop-deno
python3 - "$archive" <<'PY'
import sys, zipfile
from pathlib import Path
with zipfile.ZipFile(sys.argv[1]) as z:
    Path('/opt/pit-stop-deno/deno').write_bytes(z.read('deno'))
Path('/opt/pit-stop-deno/deno').chmod(0o755)
PY
if [[ ! -d /opt/pit-stop-cipher/.git ]]; then git clone https://github.com/kikkia/yt-cipher.git /opt/pit-stop-cipher; fi
git -C /opt/pit-stop-cipher checkout 1e1fd8e2f34ca90cf23545be72e46307bd3d3d2a
if [[ ! -d /opt/pit-stop-cipher/ejs/.git ]]; then git clone https://github.com/yt-dlp/ejs.git /opt/pit-stop-cipher/ejs; fi
git -C /opt/pit-stop-cipher/ejs checkout cd4e87f52e87ab6d8b318fd3a817adda6fafa8dc
id pit-stop-cipher >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pit-stop-cipher --shell /usr/sbin/nologin pit-stop-cipher
install -d -m 700 -o pit-stop-cipher -g pit-stop-cipher /var/lib/pit-stop-cipher
cd /opt/pit-stop-cipher
DENO_DIR=/var/lib/pit-stop-cipher/deno /opt/pit-stop-deno/deno run --allow-read --allow-write scripts/patch-ejs.ts
DENO_DIR=/var/lib/pit-stop-cipher/deno /opt/pit-stop-deno/deno cache server.ts worker.ts
chown -R pit-stop-cipher:pit-stop-cipher /var/lib/pit-stop-cipher
install -d -m 700 /etc/pit-stop-cipher
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('/etc/pit-stop-cipher/cipher.env')
if not p.exists():
    p.write_text('HOST=127.0.0.1\nPORT=8001\nMAX_THREADS=1\nPREPROCESSED_CACHE_SIZE=10\nOVERRIDE_PLAYER_VARIANT=IAS\nAPI_TOKEN='+secrets.token_urlsafe(32)+'\n')
p.chmod(0o600)
PY
install -m 644 "$script_dir/pit-stop-cipher.service" /etc/systemd/system/pit-stop-cipher.service
systemctl daemon-reload
systemctl enable --now pit-stop-cipher
echo 'Cipher service installed on localhost:8001.'
