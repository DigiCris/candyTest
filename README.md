# Candy Web2 Token

Implementación de un token con interfaz tipo ERC‑20, pero respaldado por PostgreSQL y autorizado por sesiones centralizadas en el backend.

## Ejecutar

Requisitos:

- Docker Engine
- Docker Compose v2
- Puertos libres `8080` y `3001`

```bash
chmod +x candy.sh
./candy.sh reset
```

Abrir:

- Frontend: `http://localhost:8080`
- API directa: `http://localhost:3001`

Comandos:

```bash
./candy.sh up       # construye y levanta; inicializa si la base está vacía
./candy.sh reset    # elimina el volumen PostgreSQL y crea todo desde cero
./candy.sh logs
./candy.sh status
./candy.sh down
```

También se puede usar `make up`, `make reset`, `make logs` y `make down`.

## Credenciales de demostración

| Rol | Usuario | Contraseña | Candy inicial |
|---|---|---|---:|
| Owner/admin | `admin` | `CandyAdmin!2026` | 1,000,000 |
| Usuario | `user1` | `CandyUser1!2026` | 1,000 |
| Usuario | `user2` | `CandyUser2!2026` | 1,000 |
| Usuario | `user3` | `CandyUser3!2026` | 1,000 |
| Motor del juego | `gameEngine` | `CandyGame!2026` | 100,000 |

Todas las constantes están en [`config/demo.constants.json`](config/demo.constants.json). **Son secretos públicos de demo. No reutilizarlos en producción ni enviar fondos reales a estas addresses.** Los usuarios no tienen frase semilla: sus addresses se derivan de un único xpub watch‑only (ver [Addresses y xpub](#addresses-y-xpub)).

## Token

- `name`: `Candy`
- `symbol`: `🍬` (`$CA` como fallback)
- `decimals`: `6`
- Persistencia de cantidades: `NUMERIC(78,0)`, siempre como enteros unsigned dentro del rango `uint256`.
- Los valores JSON de balances, cantidades y allowances viajan como strings para no perder precisión.

## Interfaz estilo ERC‑20

El SDK está en `packages/candy-sdk` y puede consumirse desde frontend o Node:

```js
import { CandyClient, parseUnits, formatUnits } from '@candy/web2-sdk';

const candy = new CandyClient('/api');

await candy.login('user1', 'CandyUser1!2026');
await candy.transfer('user2', 100000000n);
await candy.transfer(user2, 100000000n); // también acepta { username } o { address }
await candy.approve('gameEngine', parseUnits('25', 6));
const allowed = await candy.allowance('user1', 'gameEngine');
await candy.transferFrom('user1', 'user2', parseUnits('5', 6));

console.log(formatUnits(await candy.balanceOf('user2'), 6));
```

El backend expone `candyFor(identity)`, que liga la sesión una sola vez y deja exactamente la misma forma de llamada:

```js
import { candyFor } from './services/token-service.js';

const candy = candyFor(req.identity);
await candy.transfer('user2', 100000000n);
await candy.approve('gameEngine', 25000000n);
await candy.transferFrom('user2', 'user1', 5000000n);
```

El facade incluye `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `transfer`, `approve`, `allowance`, `transferFrom`, `mint` y `burn`. Por debajo utiliza `CandyTokenService`, que recibe la identidad explícita y permite reutilizar la misma lógica dentro de transacciones complejas, como la resolución del juego.

## Autenticación y hooks

El hook `identityHook` se ejecuta antes de los modificadores y resuelve al usuario desde una cookie JWT `HttpOnly`. Está aislado para poder reemplazar JWT por sesiones de servidor, OAuth, API keys u otro mecanismo sin cambiar el token.

- `onlyOwnerHook`: siempre activo. Protege `mint`, `burn` y la configuración de `onlyOwnerOrAllowed`.
- `onlyOwnerOrAllowedHook`: se controla desde la base de datos. Protege `transfer`, `balanceOf` y `allowance`.
  - Desactivado: actúa como no-op, pero sigue siendo necesaria una sesión válida.
  - Activado: permite al admin, al dueño de los tokens o a un spender con allowance positivo otorgado por ese dueño.

`transfer` siempre mueve tokens del usuario autenticado, igual que `msg.sender` en ERC‑20. Para mover tokens de otra persona se usa `transferFrom` y se consume allowance.

## Addresses y xpub

**Los usuarios no tienen frase semilla.** Existe un único `xpub` de cuenta *watch‑only* guardado en la base de datos (`app_settings`, key `walletAccount`), y cada address de usuario se deriva de ahí.

En el registro:

1. Se lee el `xpub` de cuenta desde la base.
2. Se reclama el siguiente índice con la secuencia `wallet_address_index_seq` (atómica: nunca entrega el mismo índice dos veces ni reutiliza uno).
3. El address se deriva **sólo desde el xpub**, como `<accountPath>/0/<index>` → `m/44'/60'/0'/0/<index>`.
4. Se guardan el address, el xpub de cuenta, los paths y el índice. No hay mnemonic en ninguna parte del flujo.

La semilla que corresponde a ese `xpub` vive en una **cold wallet offline que nunca se conecta a este servicio**. Por eso alcanza con el xpub: derivar addresses requiere sólo datos públicos, así que el backend no puede firmar ni mover fondos.

El `xpub` inicial se toma de `wallet.accountXpub` en [`config/demo.constants.json`](config/demo.constants.json) (o de la variable de entorno `CANDY_ACCOUNT_XPUB`) durante el bootstrap. El valor de demo es el xpub de cuenta de la mnemonic de test pública de Hardhat, así que **no contiene ningún secreto**; reemplazalo por el xpub de tu cold wallet antes de cualquier uso real.

### Bases de datos anteriores

Una base creada cuando cada usuario tenía su propia semilla se migra sin perder nada:

```bash
docker compose exec backend node src/db/backfill-wallets.js
```

Re-deriva las addresses obsoletas desde el xpub de cuenta. Balances, allowances, eventos y partidas referencian el UUID del usuario, así que se conservan intactos. Es idempotente: si todo ya coincide con el xpub, no hace nada.

### Qué son y qué no son estas addresses

- **Son** un identificador estable por usuario, útil para mostrar la cuenta y para futuros pagos con la cold wallet.
- **No** custodian los tokens Candy: los balances viven en la tabla `balances` de PostgreSQL.
- **No** se usan nunca para autorizar. Toda operación se valida contra la sesión del usuario (cookie JWT), nunca contra una firma de wallet.

La implementación BIP‑39/BIP‑32, secp256k1, Base58Check y Keccak‑256 es autocontenida en `apps/backend/src/utils/wallet.js`. `deriveWalletFromMnemonic` queda disponible sólo como herramienta **offline** para producir un xpub de cuenta a partir de una semilla; el registro nunca la llama. Hay tests que verifican que el xpub solo deriva las mismas addresses que la semilla, contra las cuentas estándar de Hardhat.

## Juego de dados

Flujo:

1. El usuario indica el stake.
2. El frontend ejecuta `approve(gameEngine, stake)`.
3. El backend crea una jugada, un secreto aleatorio y un salt.
4. Se muestra el commitment, pero no el secreto.
5. El usuario elige dos enteros diferentes.
6. Se calculan ambos dados de forma determinista.
7. Si gana el usuario, `gameEngine.transfer(player, stake)`.
8. Si gana `gameEngine` o hay empate, `gameEngine.transferFrom(player, gameEngine, stake)`.
9. Se revela secreto y salt para que el navegador verifique el commitment.

Fórmulas:

```text
commitment = sha256(gameId + ":" + secret + ":" + salt)
engineDie = 1 + (uint256(sha256(secret + ":" + engineNumber + ":engine")) mod 6)
playerDie = 1 + (uint256(sha256(secret + ":" + playerNumber + ":player")) mod 6)
```

Los empates son para `gameEngine`. Solo se permite una jugada abierta por usuario. Mientras está abierta, el backend reserva el stake dentro del balance y allowance del jugador, además de reservar liquidez de `gameEngine`; esas cantidades no pueden gastarse, quemarse ni revocarse desde otro endpoint. Si gana el usuario, el allowance reservado que no se utilizó se libera automáticamente.

## Estructura

```text
config/demo.constants.json       constantes, usuarios, contraseñas y xpub de cuenta demo
apps/backend/                    API Express, PostgreSQL, hooks, servicios y juego
apps/frontend/                   React/Vite, servido por Nginx
packages/candy-sdk/              SDK con interfaz estilo ERC‑20
docker-compose.yml               PostgreSQL + backend + frontend
candy.sh                         inicialización y operación de un comando
```

Más detalles:

- [`docs/API.md`](docs/API.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DEMO_ACCOUNTS.md`](docs/DEMO_ACCOUNTS.md)

## Pruebas incluidas

```bash
npm --prefix apps/backend test
npm --prefix packages/candy-sdk test
```

Prueban:

- Keccak‑256 contra el vector oficial de cadena vacía.
- Derivación BIP‑39/BIP‑32/xpub contra las addresses estándar de Hardhat.
- Que el xpub de cuenta, por sí solo, derive las mismas addresses que la semilla.
- Validación de xpub y unicidad de addresses por índice.
- Que la config no contenga frases semilla.
- Conversión entre unidades humanas y cantidades raw con seis decimales.
- Identificadores por username, address u objetos de usuario.
- Fórmula determinista de commitment y dados.

## Antes de producción

Este proyecto está configurado como demo local. Antes de exponerlo públicamente hay que, como mínimo:

- eliminar credenciales del repositorio y reemplazar el xpub de demo por el de una cold wallet propia;
- desactivar `ALLOW_DEMO_BOOTSTRAP`;
- rotar JWT, contraseña de PostgreSQL y bootstrap secret;
- usar HTTPS y `COOKIE_SECURE=true`;
- agregar rate limiting, protección CSRF y auditoría de sesiones;
- definir recuperación real de cuentas y custodia de semillas;
- auditar el juego, la economía y los requisitos legales si los Candy adquieren valor real.
