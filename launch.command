#!/bin/zsh
set -euo pipefail

console_user="$(/usr/bin/stat -f "%Su" /dev/console 2>/dev/null || true)"
if [[ -z "${console_user}" ]]; then
  console_user="${SUDO_USER:-${USER:-}}"
fi
if [[ "${console_user}" == "root" && -n "${SUDO_USER:-}" ]]; then
  console_user="${SUDO_USER}"
fi

home_dir="$(eval echo "~${console_user}")"
APP_DIR="${home_dir}/Desktop/study-journal"
URL="http://localhost:3030"
HEALTH="${URL}/api/health"

if /usr/bin/curl -fsS "$HEALTH" >/dev/null 2>&1; then
  /usr/bin/open "$URL"
  exit 0
fi

# Start server in Terminal (so it stays running) if not already healthy.
/usr/bin/osascript <<EOF
tell application "Terminal"
  activate
  do script "cd \"${APP_DIR}\" && npm start"
end tell
EOF

# Wait (up to ~5s) for server to come online, then open.
for i in {1..20}; do
  if /usr/bin/curl -fsS "$HEALTH" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.25
done

/usr/bin/open "$URL"

