# API Candy

Todas las cantidades se envían y reciben como strings decimales raw. Con `decimals = 6`, `"1000000"` representa `1 Candy`.

## Autenticación

### `POST /api/auth/register`

```json
{ "username": "alice", "password": "Password!2026" }
```

Devuelve el usuario y configura la cookie de sesión.

No hay frase semilla: la address del usuario se deriva del xpub de cuenta watch‑only guardado en la base, en el siguiente índice libre. La respuesta incluye `address`, `xpub`, `accountPath` y `addressPath`, todos datos públicos.

### `POST /api/auth/login`

```json
{ "username": "user1", "password": "CandyUser1!2026" }
```

### `POST /api/auth/logout`

### `GET /api/auth/me`

## Metadata

- `GET /api/token/name`
- `GET /api/token/symbol`
- `GET /api/token/decimals`
- `GET /api/token/totalSupply`

## ERC‑20

### `GET /api/token/balanceOf/:owner`

`owner` puede ser username o address.

### `POST /api/token/transfer`

```json
{ "to": "user2", "amount": "25000000" }
```

El origen es siempre el usuario autenticado.

### `POST /api/token/approve`

```json
{ "spender": "gameEngine", "amount": "50000000" }
```

Reemplaza el allowance actual, como `approve` de ERC‑20.

### `GET /api/token/allowance/:owner/:spender`

### `POST /api/token/transferFrom`

```json
{ "from": "user1", "to": "user2", "amount": "10000000" }
```

Falla si el caller no tiene allowance suficiente o si `from` no tiene saldo suficiente. Al ejecutarse, descuenta allowance.

### `POST /api/token/mint`

Solo admin.

```json
{ "to": "user1", "amount": "100000000" }
```

### `POST /api/token/burn`

Solo admin.

```json
{ "from": "user1", "amount": "10000000" }
```

### `GET /api/token/events?limit=20`

## Configuración de acceso

### `GET /api/admin/onlyOwnerOrAllowed`

Solo admin.

### `PUT /api/admin/onlyOwnerOrAllowed`

Solo admin.

```json
{ "enabled": true }
```

## Juego

### `POST /api/games`

```json
{ "stake": "10000000" }
```

Requiere saldo y allowance hacia `gameEngine` iguales o mayores al stake.

### `GET /api/games/:gameId`

Antes de resolver no devuelve secreto ni salt. Después de resolver los revela.

### `POST /api/games/:gameId/resolve`

```json
{ "engineNumber": "17", "playerNumber": "42" }
```

Los números deben ser enteros diferentes y caber en un `BIGINT` firmado.

## Errores principales

| Código | Significado |
|---|---|
| `AUTH_REQUIRED` | No hay una sesión válida. |
| `ONLY_OWNER` | El endpoint exige admin. |
| `OWNER_OR_ALLOWANCE_REQUIRED` | El gate está activo y el caller no está autorizado. |
| `USER_NOT_FOUND` | Username o address inexistente. |
| `INVALID_AMOUNT` | No es un entero unsigned dentro de uint256. |
| `INSUFFICIENT_BALANCE` | El saldo no cubre la operación. |
| `INSUFFICIENT_ALLOWANCE` | El allowance no cubre `transferFrom` o el stake. |
| `BALANCE_RESERVED_FOR_GAME` | Parte del saldo está reservada por una jugada abierta. |
| `ALLOWANCE_RESERVED_FOR_GAME` | Parte del allowance está reservada por una jugada abierta. |
| `GAME_ENGINE_LIQUIDITY` | El motor no puede cubrir un premio potencial. |
| `OPEN_GAME_EXISTS` | El usuario ya tiene una jugada pendiente. |
