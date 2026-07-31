# Validación realizada

- Tests Node del backend: 5/5.
- Tests del SDK: 3/3.
- Verificación sintáctica de todos los archivos JavaScript del backend y SDK.
- Parseo JSX del frontend mediante TypeScript en modo `noEmit`.
- Parseo de todos los JSON y de `docker-compose.yml`.
- Verificación sintáctica de `candy.sh`.

No fue posible ejecutar el stack Docker completo dentro del entorno de generación porque Docker/PostgreSQL no están instalados allí. El comando previsto para el usuario es `./candy.sh reset`.
