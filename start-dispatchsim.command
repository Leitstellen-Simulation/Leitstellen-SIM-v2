#!/bin/zsh -l

cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
dispatchsim_url="http://127.0.0.1:${PORT:-4173}/index.html"

dispatchsim_ready() {
  /usr/bin/curl --fail --silent --max-time 1 "$dispatchsim_url" | /usr/bin/grep -q 'id="dispatch-screen"'
}

if dispatchsim_ready; then
  /usr/bin/open "$dispatchsim_url"
  exit $?
fi

if ! command -v node >/dev/null; then
  print -u2 'Node.js wurde nicht gefunden. Bitte Node.js installieren und den Start erneut versuchen.'
  if [[ -t 0 ]]; then read -r '?Zum Schließen Enter drücken.'; fi
  exit 1
fi

node server.mjs &
dispatchsim_pid=$!
trap 'kill "$dispatchsim_pid" 2>/dev/null' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
print 'Leitstellen-SIM startet. Mit Ctrl+C beenden.'

for ((attempt = 0; attempt < 100; attempt++)); do
  if ! kill -0 "$dispatchsim_pid" 2>/dev/null; then
    wait "$dispatchsim_pid"
    exit $?
  fi
  if dispatchsim_ready; then
    /usr/bin/open "$dispatchsim_url"
    break
  fi
  /bin/sleep 0.2
done

if (( attempt == 100 )); then
  print "Sobald der Server bereit ist, die Adresse im Browser öffnen: $dispatchsim_url"
fi
wait "$dispatchsim_pid"
