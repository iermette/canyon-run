#!/usr/bin/env bash
# Lancement rapide de Canyon Run : ouvre le navigateur et lance le serveur.
# La fenêtre reste ouverte tant que le jeu tourne ; la fermer arrête le serveur.
# Au démarrage, le serveur demande quelle interface réseau utiliser pour le
# multijoueur (Entrée = dernier choix, ou toutes les interfaces).
# Usage: ./launch.sh        -> lance (et ouvre le navigateur)
#        ./launch.sh stop   -> arrête un serveur encore en cours d'exécution
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
URL="http://localhost:${PORT}"
PIDFILE=".server.pid"
URLFILE=".server.url" # l'URL réelle écrite par le serveur après le choix d'interface

is_up() {
  local u
  for u in "$URL" "$(cat "$URLFILE" 2>/dev/null || true)"; do
    [[ -n "$u" ]] || continue
    node -e "fetch('$u').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1 && return 0
  done
  return 1
}

open_browser() {
  local url="$URL"
  if [[ -f "$URLFILE" ]]; then url="$(cat "$URLFILE")"; fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  fi
}

if [[ "${1:-}" == "stop" ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    PID="$(cat "$PIDFILE")"
    kill "$PID"
    rm -f "$PIDFILE" "$URLFILE"
    echo "Serveur arrêté (PID $PID)."
  else
    rm -f "$PIDFILE" "$URLFILE"
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
rm -f "$URLFILE" # le serveur l'écrit une fois l'interface choisie
# ouvre le navigateur dès que le serveur annonce son URL (sous-processus indépendant)
( for _ in $(seq 1 100); do [[ -f "$URLFILE" ]] && break; sleep 0.2; done; open_browser ) &

echo "Canyon Run : le serveur va demander l'interface réseau du multijoueur (Entrée = défaut)."
echo "Serveur PID : $$ (enregistré dans $PIDFILE)"
echo "Ne pas fermer cette fenêtre pendant la partie — la fermer arrête le serveur."
exec node server.js
