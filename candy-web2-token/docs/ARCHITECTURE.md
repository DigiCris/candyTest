# Arquitectura

## Capas

### Frontend

React/Vite consume `@candy/web2-sdk`. Nginx sirve la SPA y redirige `/api` al backend, por lo que la cookie queda en el mismo origen del frontend.

### SDK

`CandyClient` replica nombres de ERC‑20 y convierte la respuesta HTTP en `bigint`. Los identificadores aceptan username, address u objetos con `{ username }` / `{ address }`; el SDK los normaliza antes de llamar al backend.

### Backend

Express organiza la ejecución así:

```text
request
  -> identityHook
  -> requireIdentity
  -> onlyOwnerHook / onlyOwnerOrAllowedHook
  -> CandyTokenService
  -> PostgreSQL transaction
```

La identidad está abstraída del token. Cambiar JWT por otro método requiere sustituir `identityHook` y la emisión de sesión, no las reglas contables.

### Base de datos

Tablas principales:

- `users`: identidad, role, address y xpub.
- `balances`: una fila bloqueable por usuario.
- `allowances`: `(owner_id, spender_id)`.
- `token_metadata`: metadata y total supply.
- `token_events`: ledger de mint, burn, transfer y approval.
- `app_settings`: flag `onlyOwnerOrAllowed`.
- `games`: commitment, secreto, elecciones y resultado.

## Atomicidad

`transfer`, `transferFrom`, `mint`, `burn` y resolución del juego se ejecutan en transacciones SQL.

- Las filas de balances se bloquean en orden determinista por UUID para reducir deadlocks.
- `transferFrom` bloquea el allowance antes de verificarlo y consumirlo.
- Si falla cualquier validación, se revierte balance, allowance, supply, evento y juego.

## Paridad conceptual con ERC‑20

| ERC‑20 | Candy Web2 |
|---|---|
| `msg.sender` | usuario resuelto por `identityHook` |
| storage del contrato | PostgreSQL |
| modifier `onlyOwner` | `onlyOwnerHook` + role admin |
| `mapping(address => uint256)` | tabla `balances` |
| allowances anidados | tabla `allowances` |
| eventos | tabla `token_events` |
| firma criptográfica | cookie/sesión validada centralmente |
| transacción atómica EVM | transacción SQL |

## Wallets frías

Cada usuario tiene su propia mnemonic. El servidor de demo la conoce únicamente durante el registro o bootstrap, deriva un xpub de cuenta y luego guarda:

- xpub;
- address;
- paths de derivación.

El backend no necesita private keys para operar Candy porque Candy es un ledger Web2. La address se usa como identificador interoperable y para consultar activos públicos en Base.

## Juego

El commit‑reveal evita que el jugador conozca el secreto antes de elegir. El commitment fija el secreto y el salt antes de las elecciones. Al resolver, se revela todo y el navegador recompone el hash.

Esto demuestra verificabilidad, pero no convierte al operador centralizado en trustless: el backend sigue controlando disponibilidad, ejecución y publicación del secreto.


## Reservas de juego

Una fila `games` en estado `committed` funciona como una reserva lógica, sin mover todavía los tokens:

- el stake queda reservado dentro del balance del jugador y dentro de su allowance hacia `gameEngine`;
- el mismo stake queda reservado dentro del balance de `gameEngine` para cubrir una victoria del jugador;
- `transfer`, `transferFrom`, `burn` y `approve` calculan el monto disponible después de esas reservas;
- la resolución excluye únicamente su propia reserva y liquida atómicamente mediante `transfer` o `transferFrom`;
- si gana el jugador, se descuenta del allowance la aprobación de esa apuesta que quedó sin utilizar.

Esto evita que una persona abra una jugada y luego retire el stake o revoque el allowance para hacer que solamente fallen los resultados perdedores.
