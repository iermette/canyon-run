#!/usr/bin/env bash
# Lancement rapide de Canyon Run : ouvre le navigateur et lance le serveur.
# La fenêtre reste ouverte tant que le jeu tourne ; la fermer arrête le serveur.
# Usage: ./launch.sh        -> lance (et ouvre le navigateur)
#        ./launch.sh stop   -> arrête un serveur encore en cours d'exécution
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
URL="http://localhost:${PORT}"
PIDFILE=".server.pid"

is_up() {
  node -e "fetch('$URL').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  fi
}

if [[ "${1:-}" == "stop" ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    PID="$(cat "$PIDFILE")"
    kill "$PID"
    rm -f "$PIDFILE"
    echo "Serveur arrêté (PID $PID)."
  else
    rm -f "$PIDFILE"
    echo "Aucun serveur en cours d'exécution."
  fi
  exit 0
fi

if is_up; then
  RUNNING_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${RUNNING_PID}" ]] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    echo "Serveur déjà actif sur $URL (PID $RUNNING_PID) — navigateur ouvert."
  else
    echo "Serveur déjà actif sur $URL (PID inconnu) — navigateur ouvert."
  fi
  open_browser
  exit 0
fi

echo $$ > "$PIDFILE" # après exec, ce PID sera celui de node
# ouvre le navigateur dès que le serveur répond (sous-processus indépendant)
( for _ in $(seq 1 50); do is_up && break; sleep 0.2; done; open_browser ) &

echo "Canyon Run : $URL"
echo "Serveur PID : $$ (enregistré dans $PIDFILE)"
echo "Ne pas fermer cette fenêtre pendant la partie — la fermer arrête le serveur."
exec node server.js
