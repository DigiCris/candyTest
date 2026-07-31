# Cuentas demo

**Todas estas contraseñas son públicas y exclusivas para desarrollo local.**

Los usuarios **no tienen frase semilla**. Todas las addresses se derivan de un único xpub de cuenta *watch‑only* guardado en la base de datos, en orden de registro:

```text
accountPath: m/44'/60'/0'
accountXpub: xpub6Ce9NcJvTk36xtLSrJLZqE7wtgA5deCeYs7rSQtreh4cj6ByPtrg9sD7V2FNFLPnf8heNP3FGkeV9qwfzvZNSd54JoNXVsXFYSYwHsnJxqP
```

Ese xpub es el nodo de cuenta de la mnemonic de test **pública** de Hardhat (`test test … junk`), elegida a propósito para que el repo no contenga ningún secreto. En un despliegue real se reemplaza por el xpub de una cold wallet offline, y la semilla nunca entra a este servicio.

| # | Usuario | Password | Role | Address (`m/44'/60'/0'/0/#`) | Candy inicial |
|---|---|---|---|---|---:|
| 0 | `admin` | `CandyAdmin!2026` | `admin` | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | 1,000,000 |
| 1 | `user1` | `CandyUser1!2026` | `user` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | 1,000 |
| 2 | `user2` | `CandyUser2!2026` | `user` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | 1,000 |
| 3 | `user3` | `CandyUser3!2026` | `user` | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | 1,000 |
| 4 | `gameEngine` | `CandyGame!2026` | `game_engine` | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | 100,000 |

El índice lo asigna la secuencia `wallet_address_index_seq`, así que los usuarios que se registren después del bootstrap siguen desde el índice 5.

## Qué significan estas addresses

- Identifican al usuario (mostrarlo en la UI, destino de futuros pagos desde la cold wallet).
- **No** custodian los tokens Candy: los balances están en la tabla `balances`.
- **Nunca** se usan para autorizar. Toda operación se valida contra la sesión del usuario, no contra una firma.
