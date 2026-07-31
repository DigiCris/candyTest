import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { formatUnits, parseUnits, readBaseUsdcBalance } from '@candy/web2-sdk';
import { candy, errorMessage, shortAddress } from './lib/api.js';

function Button({ children, busy, className = '', ...props }) {
  return <button {...props} className={`button ${className}`} disabled={busy || props.disabled}>{busy ? 'Procesando…' : children}</button>;
}

function Field({ label, hint, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} />{hint && <small>{hint}</small>}</label>;
}

function Notice({ type = 'info', children }) {
  if (!children) return null;
  return <div className={`notice ${type}`}>{children}</div>;
}

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('user1');
  const [password, setPassword] = useState('CandyUser1!2026');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const [pendingUser, setPendingUser] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setRecovery('');
    try {
      const result = mode === 'login'
        ? await candy.login(username, password)
        : await candy.register(username, password);
      if (result.recoveryPhrase) {
        setRecovery(result.recoveryPhrase);
        setPendingUser(result.user);
      } else {
        onAuthenticated(result.user);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand large"><span>♜</span><div><strong>Candy Table</strong><small>La mesa está servida</small></div></div>
      <h1>Tu próxima partida comienza acá.</h1>
      <p className="muted">Entrá a la mesa, prepará tus fichas y desafiá a la casa en una partida de dados.</p>
      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Ingresar</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Registrarme</button>
      </div>
      <form onSubmit={submit} className="stack">
        <Field label="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <Field label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        <Button busy={busy} type="submit">{mode === 'login' ? 'Entrar a la mesa' : 'Crear mi cuenta'}</Button>
      </form>
      <Notice type="error">{error}</Notice>
      {recovery && <Notice type="warning"><strong>Frase de recuperación — se muestra una sola vez:</strong><code>{recovery}</code><Button onClick={() => onAuthenticated(pendingUser)} className="recovery-button">Ya la guardé, continuar</Button></Notice>}
      <div className="demo-hint"><strong>Cuenta de invitado:</strong> user1 / CandyUser1!2026</div>
    </section>
  </main>;
}

function ActionCard({ title, description, children }) {
  return <section className="panel"><div className="panel-heading"><h3>{title}</h3>{description && <p>{description}</p>}</div>{children}</section>;
}

function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [balance, setBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [allowanceResult, setAllowanceResult] = useState(null);
  const [gateEnabled, setGateEnabled] = useState(false);

  const decimals = config?.token?.decimals ?? 6;
  const symbol = config?.token?.symbol ?? '🍬';

  const refresh = useCallback(async () => {
    const publicConfig = await candy.publicConfig();
    setConfig(publicConfig);
    const [rawBalance, eventPayload] = await Promise.all([
      candy.balanceOf(user.address),
      candy.request('/token/events?limit=12'),
    ]);
    setBalance(rawBalance);
    setEvents(eventPayload.events || []);
    if (user.role === 'admin') setGateEnabled(await candy.getOnlyOwnerOrAllowed());
    if (user.role !== 'admin') {
      setUsdcBalance(null);
      return;
    }
    try {
      const external = publicConfig.external;
      const rawUsdc = await readBaseUsdcBalance({
        rpcUrl: external.baseRpcUrl,
        tokenAddress: external.baseUsdcAddress,
        ownerAddress: user.address,
      });
      setUsdcBalance(rawUsdc);
    } catch { setUsdcBalance(null); }
  }, [user.address, user.role]);

  useEffect(() => { refresh().catch((err) => setError(errorMessage(err))); }, [refresh]);

  async function run(key, action, success) {
    setBusy(key); setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  async function logout() { await candy.logout(); onLogout(); }

  const gameEngine = config?.gameEngine;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span>♜</span><div><strong>Candy Table</strong><small>Club de juego</small></div></div>
      <div className="user-chip"><div><strong>{user.username}</strong><small>{user.role === 'admin' ? 'Administrador' : 'Jugador'} · {shortAddress(user.address)}</small></div><button onClick={logout}>Salir</button></div>
    </header>

    <main className="content">
      <section className={`hero-grid ${user.role !== 'admin' ? 'player-hero' : ''}`}>
        <div className="balance-card candy-card"><span>Fichas disponibles</span><strong>{formatUnits(balance, decimals)} {symbol}</strong><small>Tu saldo para jugar y transferir</small></div>
        {user.role === 'admin' && <div className="balance-card"><span>Reserva externa</span><strong>{usdcBalance === null ? 'No disponible' : `${formatUnits(usdcBalance, 6)} USDC`}</strong><small>Balance en la red Base</small></div>}
        {user.role === 'admin' && <div className="balance-card address-card"><span>Dirección de la cuenta</span><strong>{shortAddress(user.address)}</strong><button onClick={() => navigator.clipboard.writeText(user.address)}>Copiar</button></div>}
        {user.role !== 'admin' && <div className="welcome-card"><span className="eyebrow">Mesa abierta</span><h1>¿Listo para jugar?</h1><p>Transferí fichas a otros jugadores o apostalas en tu próxima partida contra la casa.</p></div>}
      </section>

      <Notice type="success">{message}</Notice><Notice type="error">{error}</Notice>

      <section className={`action-grid ${user.role !== 'admin' ? 'player-actions' : ''}`}>
        <ActionCard title="Enviar fichas" description="Transferí Candy a otro jugador de la mesa.">
          <OperationForm fields={[['to','Destino','user2'],['amount','Cantidad','25.5']]} button="Transferir" busy={busy === 'transfer'} onSubmit={(data) => run('transfer', () => candy.transfer(data.to, parseUnits(data.amount, decimals)), 'Transferencia realizada.')} />
        </ActionCard>

        {user.role === 'admin' && <ActionCard title="Autorizar operador" description="Define el límite de fichas que puede gestionar una cuenta.">
          <OperationForm fields={[['spender','Operador','gameEngine'],['amount','Límite','50']]} button="Autorizar" busy={busy === 'approve'} onSubmit={(data) => run('approve', () => candy.approve(data.spender, parseUnits(data.amount, decimals)), 'Autorización actualizada.')} />
        </ActionCard>}

        {user.role === 'admin' && <ActionCard title="Consultar autorización" description="Revisá el límite disponible entre dos cuentas.">
          <OperationForm fields={[['owner','Cuenta','user1'],['spender','Operador','gameEngine']]} button="Consultar" busy={busy === 'allowance'} onSubmit={(data) => run('allowance', async () => setAllowanceResult(await candy.allowance(data.owner, data.spender)), 'Autorización consultada.')} />
          {allowanceResult !== null && <div className="result-box">{formatUnits(allowanceResult, decimals)} {symbol}<small>Disponible para operar</small></div>}
        </ActionCard>}

        {user.role === 'admin' && <ActionCard title="Transferencia delegada" description="Mové fichas en nombre de una cuenta autorizada.">
          <OperationForm fields={[['from','Desde','user2'],['to','Hacia','user1'],['amount','Cantidad','10']]} button="Transferir por cuenta" busy={busy === 'transferFrom'} onSubmit={(data) => run('transferFrom', () => candy.transferFrom(data.from, data.to, parseUnits(data.amount, decimals)), 'Transferencia delegada realizada.')} />
        </ActionCard>}
      </section>

      <section className="game-banner">
        <div><span className="eyebrow">Partida destacada</span><h2>Desafiá a la casa</h2><p>Elegí tu apuesta y enfrentate a la máquina. Cada tirada es verificable y el resultado se define de forma transparente.</p></div>
        <PlayForm disabled={!gameEngine} decimals={decimals} busy={busy === 'game'} onPlay={(amount) => run('game', async () => {
          const raw = parseUnits(amount, decimals);
          await candy.approve(gameEngine.address, raw);
          const result = await candy.startGame(raw);
          navigate(`/game/${result.game.id}`);
        }, 'Jugada creada.')} />
      </section>

      {user.role === 'admin' && <section className="admin-section">
        <div className="section-title"><span className="eyebrow">Sala de control</span><h2>Administración de la mesa</h2></div>
        <div className="action-grid">
          <ActionCard title="Emitir fichas"><OperationForm fields={[['to','Usuario','user1'],['amount','Cantidad','100']]} button="Emitir" busy={busy === 'mint'} onSubmit={(data) => run('mint', () => candy.mint(data.to, parseUnits(data.amount, decimals)), 'Emisión realizada.')} /></ActionCard>
          <ActionCard title="Retirar fichas"><OperationForm fields={[['from','Usuario','user1'],['amount','Cantidad','10']]} button="Retirar" busy={busy === 'burn'} onSubmit={(data) => run('burn', () => candy.burn(data.from, parseUnits(data.amount, decimals)), 'Retiro realizado.')} /></ActionCard>
          <ActionCard title="Control de operaciones" description="Restringe las consultas y transferencias a cuentas autorizadas.">
            <div className="toggle-row"><div><strong>{gateEnabled ? 'Activado' : 'Desactivado'}</strong><small>{gateEnabled ? 'Sólo las cuentas autorizadas pueden operar.' : 'Todas las cuentas habilitadas pueden operar.'}</small></div><button className={`switch ${gateEnabled ? 'on' : ''}`} onClick={() => run('gate', async () => { const r = await candy.setOnlyOwnerOrAllowed(!gateEnabled); setGateEnabled(r.enabled); }, 'Configuración actualizada.')}><span /></button></div>
          </ActionCard>
        </div>
      </section>}

      <section className="events-section"><div className="section-title"><span className="eyebrow">Historial</span><h2>Movimientos de la mesa</h2></div><div className="events-list">
        {events.map((event) => <div className="event-row" key={event.id}><span className={`event-type ${event.event_type.toLowerCase()}`}>{eventTypeLabel(event.event_type)}</span><div><strong>{event.from_username || 'Mesa'} → {event.to_username || event.spender_username || 'Mesa'}</strong><small>{formatUnits(BigInt(event.amount), decimals)} {symbol} · realizado por {event.actor_username || 'la mesa'}</small></div><time>{new Date(event.created_at).toLocaleString()}</time></div>)}
      </div></section>
    </main>
  </div>;
}

function OperationForm({ fields, button, onSubmit, busy }) {
  const initial = useMemo(() => Object.fromEntries(fields.map(([name,,placeholder]) => [name, placeholder])), [fields]);
  const [values, setValues] = useState(initial);
  return <form className="compact-form" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
    {fields.map(([name,label,placeholder]) => <Field key={name} label={label} value={values[name]} placeholder={placeholder} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} />)}
    <Button busy={busy} type="submit">{button}</Button>
  </form>;
}

function eventTypeLabel(type) {
  return {
    TRANSFER: 'Envío',
    APPROVAL: 'Permiso',
    MINT: 'Emisión',
    BURN: 'Retiro',
  }[type] || type;
}

function PlayForm({ onPlay, busy, disabled }) {
  const [amount, setAmount] = useState('10');
  return <form className="play-form" onSubmit={(event) => { event.preventDefault(); onPlay(amount); }}><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="Cantidad a apostar" /><Button busy={busy} disabled={disabled} type="submit">Jugar</Button></form>;
}

const DICE = ['⚀','⚁','⚂','⚃','⚄','⚅'];

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function GamePage({ user }) {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [config, setConfig] = useState(null);
  const [engineNumber, setEngineNumber] = useState('17');
  const [playerNumber, setPlayerNumber] = useState('42');
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(null);

  useEffect(() => {
    Promise.all([candy.getGame(gameId), candy.publicConfig()])
      .then(([result, publicConfig]) => { setGame(result.game); setConfig(publicConfig); })
      .catch((err) => setError(errorMessage(err)));
  }, [gameId]);

  useEffect(() => {
    if (!game?.secret) return;
    sha256Hex(`${game.id}:${game.secret}:${game.salt}`).then((hash) => setVerified(hash === game.commitmentHash));
  }, [game]);

  async function play() {
    setRolling(true); setError('');
    try {
      const [result] = await Promise.all([
        candy.resolveGame(gameId, engineNumber, playerNumber),
        new Promise((resolve) => setTimeout(resolve, 2300)),
      ]);
      setGame(result.game);
    } catch (err) { setError(errorMessage(err)); }
    finally { setRolling(false); }
  }

  if (!game || !config) return <main className="game-shell"><div className="game-card">Cargando jugada…<Notice type="error">{error}</Notice></div></main>;
  const decimals = config.token.decimals;
  const resolved = game.status === 'resolved';

  return <main className="game-shell"><section className="game-card">
    <button className="back-link" onClick={() => navigate('/')}>← Volver a la mesa</button>
    <span className="eyebrow">Partida {game.id.slice(0, 8)}</span><h1>Duelo de dados</h1>
    <div className="commitment"><span>Sello de imparcialidad de la partida</span><code>{game.commitmentHash}</code></div>
    <div className="stake-pill">Apuesta: {formatUnits(BigInt(game.stake), decimals)} {config.token.symbol}</div>

    <div className="dice-stage">
      <div className={`die ${rolling ? 'rolling engine' : ''}`}><span>{resolved ? DICE[game.engineDie - 1] : '⚄'}</span><small>La casa</small></div>
      <div className="versus">VS</div>
      <div className={`die ${rolling ? 'rolling player' : ''}`}><span>{resolved ? DICE[game.playerDie - 1] : '⚁'}</span><small>{user.username}</small></div>
    </div>

    {!resolved ? <div className="game-controls"><Field label="Número de la casa" value={engineNumber} onChange={(event) => setEngineNumber(event.target.value)} inputMode="numeric" /><Field label="Tu número" value={playerNumber} onChange={(event) => setPlayerNumber(event.target.value)} inputMode="numeric" /><Button busy={rolling} onClick={play}>Tirar los dados</Button></div> : <div className={`game-result ${game.winner === 'player' ? 'win' : 'lose'}`}><strong>{game.winner === 'player' ? '¡Ganaste la partida!' : 'La casa se lleva la ronda'}</strong><span>{game.playerDie} contra {game.engineDie}{game.playerDie === game.engineDie ? ' · los empates favorecen a la casa' : ''}</span></div>}
    <Notice type="error">{error}</Notice>

    <details className="formula"><summary>Ver imparcialidad de la partida</summary><code>commitment = {game.formula.commitment}</code><code>engineDie = {game.formula.engineDie}</code><code>playerDie = {game.formula.playerDie}</code><code>{game.formula.winner}</code></details>
    {resolved && <div className="reveal"><h3>Comprobación de la ronda</h3><div><span>Secreto revelado</span><code>{game.secret}</code></div><div><span>Salt</span><code>{game.salt}</code></div><div><span>Resultado verificado en tu navegador</span><strong>{verified === null ? 'Verificando…' : verified ? '✓ Partida válida' : '✕ No coincide'}</strong></div></div>}
  </section></main>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { candy.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="splash">🍬</div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  return <Routes><Route path="/" element={<Dashboard user={user} onLogout={() => setUser(null)} />} /><Route path="/game/:gameId" element={<GamePage user={user} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
