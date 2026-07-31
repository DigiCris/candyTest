#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "Error: Docker no está instalado." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Error: Docker Compose v2 no está disponible." >&2; exit 1; }

BOOTSTRAP_SECRET="$(sed -nE 's/^[[:space:]]*"secret": "([^"]+)".*/\1/p' config/demo.constants.json | head -n1)"

wait_backend() {
  echo "Esperando al backend..."
  for _ in $(seq 1 60); do
    if docker compose exec -T backend node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "El backend no respondió. Revisá: ./candy.sh logs" >&2
  return 1
}

seed_demo() {
  docker compose exec -T backend node - "$BOOTSTRAP_SECRET" <<'NODE'
const secret = process.argv[2];
const response = await fetch('http://localhost:3001/api/bootstrap/seed', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-bootstrap-secret': secret },
  body: '{}',
});
const payload = await response.json();
if (!response.ok) {
  console.error(payload);
  process.exit(1);
}
console.log(payload.initialized ? 'Base inicializada y usuarios creados.' : 'La base ya estaba inicializada.');
NODE
}

start_stack() {
  docker compose up -d --build
  wait_backend
  seed_demo
  echo
  echo "Candy está listo: http://localhost:8080"
  echo "API directa:       http://localhost:3001"
  echo "Usuario demo:      user1 / CandyUser1!2026"
  echo "Admin demo:        admin / CandyAdmin!2026"
}

case "${1:-up}" in
  up)
    start_stack
    ;;
  reset)
    echo "Eliminando contenedores y volumen PostgreSQL..."
    docker compose down -v --remove-orphans
    start_stack
    ;;
  down)
    docker compose down
    ;;
  logs)
    docker compose logs -f --tail=200
    ;;
  status)
    docker compose ps
    ;;
  *)
    echo "Uso: ./candy.sh {up|reset|down|logs|status}" >&2
    exit 1
    ;;
esac
