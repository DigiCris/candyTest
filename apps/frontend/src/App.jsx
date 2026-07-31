import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { formatUnits, parseUnits, readBaseUsdcBalance } from '@candy/web2-sdk';
import { candy, errorMessage, shortAddress } from './lib/api.js';

/* ---------- icons (inline, dependency-free) ---------- */

function Icon({ children, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}
function ChipMark({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".16" />
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.4" />
    {Array.from({ length: 8 }, (_, i) => <line key={i} x1="12" y1="1.7" x2="12" y2="3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${i * 45} 12 12)`} />)}
  </svg>;
}
function IconUser(props) { return <Icon {...props}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 19.5c1.4-3.8 4.4-5.7 7.5-5.7s6.1 1.9 7.5 5.7" /></Icon>; }
function IconLock(props) { return <Icon {...props}><rect x="5" y="10.5" width="14" height="9" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" /></Icon>; }
function IconUnlock(props) { return <Icon {...props}><rect x="5" y="10.5" width="14" height="9" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 7.7-1.9" /></Icon>; }
function IconSend(props) { return <Icon {...props}><path d="M21 3 3 10.5l7.2 2.8L13 20.5 21 3Z" /><path d="M10.2 13.3 21 3" /></Icon>; }
function IconShield(props) { return <Icon {...props}><path d="M12 3.2 19.5 6v5.4c0 5-3.2 8.6-7.5 9.9-4.3-1.3-7.5-4.9-7.5-9.9V6L12 3.2Z" /></Icon>; }
function IconSearch(props) { return <Icon {...props}><circle cx="10.5" cy="10.5" r="6.3" /><path d="m20 20-4.6-4.6" /></Icon>; }
function IconRepeat(props) { return <Icon {...props}><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></Icon>; }
function IconPlusCircle(props) { return <Icon {...props}><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></Icon>; }
function IconMinusCircle(props) { return <Icon {...props}><circle cx="12" cy="12" r="9" /><line x1="8" y1="12" x2="16" y2="12" /></Icon>; }
function IconLogOut(props) { return <Icon {...props}><path d="M9 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H9" /><path d="M14 16l4-4-4-4" /><line x1="18" y1="12" x2="9" y2="12" /></Icon>; }
function IconAlert(props) { return <Icon {...props}><path d="M12 3.5 21 19H3L12 3.5Z" /><line x1="12" y1="9.5" x2="12" y2="13.3" /><line x1="12" y1="16.1" x2="12" y2="16.15" /></Icon>; }
function IconInfo(props) { return <Icon {...props}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.55" /></Icon>; }
function IconCheck(props) { return <Icon {...props}><polyline points="4.5 12.5 9.5 17.5 19.5 6.5" /></Icon>; }
function IconX(props) { return <Icon {...props}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Icon>; }

const NOTICE_ICONS = { error: <IconAlert size={17} />, success: <IconCheck size={17} />, warning: <IconAlert size={17} />, info: <IconInfo size={17} /> };
const EVENT_ICONS = { TRANSFER: <IconSend size={13} />, APPROVAL: <IconShield size={13} />, MINT: <IconPlusCircle size={13} />, BURN: <IconMinusCircle size={13} /> };

/* ---------- shared primitives ---------- */

function Button({ children, busy, className = '', ...props }) {
  return <button {...props} className={`button ${className}`} disabled={busy || props.disabled}>
    {busy && <span className="spinner" />}
    <span>{busy ? 'Procesando…' : children}</span>
  </button>;
}

function Field({ label, hint, icon, ...props }) {
  return <label className="field">
    <span>{label}</span>
    <div className={`input-wrap ${icon ? 'has-icon' : ''}`}>
      {icon && <span className="input-icon">{icon}</span>}
      <input {...props} />
    </div>
    {hint && <small>{hint}</small>}
  </label>;
}

function Notice({ type = 'info', children }) {
  if (!children) return null;
  return <div className={`notice ${type}`}>
    <span className="notice-icon">{NOTICE_ICONS[type]}</span>
    <div className="notice-body">{children}</div>
  </div>;
}

function Avatar({ name }) {
  return <div className="avatar">{(name || '?').trim().slice(0, 2).toUpperCase()}</div>;
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
    <div className="auth-wrap">
      <section className="auth-showcase" aria-hidden="true">
        <span className="eyebrow">Candy Table</span>
        <h1>El juego de mesa de tus fichas Candy.</h1>
        <p className="muted">Transferencias instantáneas, control total de tu saldo y partidas verificables en cada tirada.</p>
        <ul className="showcase-list">
          <li><IconShield size={19} /> Custodia y control total de tus fichas</li>
          <li><IconRepeat size={19} /> Transferencias entre jugadores al instante</li>
          <li><IconSearch size={19} /> Resultado de cada partida, verificable</li>
        </ul>
        <div className="showcase-chips">
          <span className="chip-stack c1" /><span className="chip-stack c2" /><span className="chip-stack c3" />
        </div>
      </section>

      <section className="auth-card">
        <div className="brand"><span><ChipMark size={24} /></span><div><strong>Candy Table</strong><small>La mesa está servida</small></div></div>
        <h2>{mode === 'login' ? 'Ingresá a tu cuenta' : 'Creá tu cuenta'}</h2>
        <p className="muted small">{mode === 'login' ? 'Ingresá tus credenciales para entrar a la mesa.' : 'Registrate para recibir tus fichas y empezar a jugar.'}</p>

        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Ingresar</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Registrarme</button>
        </div>
        <form onSubmit={submit} className="stack">
          <Field label="Usuario" icon={<IconUser size={17} />} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          <Field label="Contraseña" icon={<IconLock size={17} />} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          <Button busy={busy} type="submit">{mode === 'login' ? 'Entrar a la mesa' : 'Crear mi cuenta'}</Button>
        </form>
        <Notice type="error">{error}</Notice>
        {recovery && <Notice type="warning"><strong>Frase de recuperación — se muestra una sola vez:</strong><code>{recovery}</code><Button onClick={() => onAuthenticated(pendingUser)} className="recovery-button">Ya la guardé, continuar</Button></Notice>}
        <div className="demo-hint"><strong>Cuenta de invitado:</strong> user1 / CandyUser1!2026</div>
      </section>
    </div>
  </main>;
}

function ActionCard({ title, description, icon, children }) {
  return <section className="panel">
    <div className="panel-heading">
      {icon && <span className="panel-icon">{icon}</span>}
      <div className="panel-heading-text"><h3>{title}</h3>{description && <p>{description}</p>}</div>
    </div>
    {children}
  </section>;
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
      <div className="brand"><span><ChipMark size={22} /></span><div><strong>Candy Table</strong><small>Sala de juego</small></div></div>
      <div className="user-chip">
        <Avatar name={user.username} />
        <div><strong>{user.username}</strong><small>{user.role === 'admin' ? 'Administrador' : 'Jugador'} · {shortAddress(user.address)}</small></div>
        <button onClick={logout}><IconLogOut size={15} /> Salir</button>
      </div>
    </header>

    <main className="content">
      <section className={`hero-grid ${user.role !== 'admin' ? 'player-hero' : ''}`}>
        <div className="balance-card candy-card">
          <div className="balance-card-top"><span>Fichas disponibles</span><span className="balance-card-icon"><ChipMark size={18} /></span></div>
          <strong>{formatUnits(balance, decimals)} {symbol}</strong><small>Tu saldo para jugar y transferir</small>
        </div>
        {user.role === 'admin' && <div className="balance-card">
          <div className="balance-card-top"><span>Reserva externa</span><span className="balance-card-icon"><IconShield size={16} /></span></div>
          <strong>{usdcBalance === null ? 'No disponible' : `${formatUnits(usdcBalance, 6)} USDC`}</strong><small>Balance en la red Base</small>
        </div>}
        {user.role === 'admin' && <div className="balance-card address-card">
          <div className="balance-card-top"><span>Dirección de la cuenta</span><span className="balance-card-icon"><IconUser size={16} /></span></div>
          <strong>{shortAddress(user.address)}</strong><button onClick={() => navigator.clipboard.writeText(user.address)}>Copiar</button>
        </div>}
        {user.role !== 'admin' && <div className="welcome-card"><span className="eyebrow">Mesa abierta</span><h1>¿Listo para jugar?</h1><p>Transferí fichas a otros jugadores o apostalas en tu próxima partida contra la máquina.</p></div>}
      </section>

      <Notice type="success">{message}</Notice><Notice type="error">{error}</Notice>

      <section className={`action-grid ${user.role !== 'admin' ? 'player-actions' : ''}`}>
        <ActionCard title="Enviar fichas" description="Transferí Candy a otro jugador de la mesa." icon={<IconSend size={18} />}>
          <OperationForm fields={[['to','Destino','user2'],['amount','Cantidad','25.5']]} button="Transferir" busy={busy === 'transfer'} onSubmit={(data) => run('transfer', () => candy.transfer(data.to, parseUnits(data.amount, decimals)), 'Transferencia realizada.')} />
        </ActionCard>

        {user.role === 'admin' && <ActionCard title="Autorizar operador" description="Define el límite de fichas que puede gestionar una cuenta." icon={<IconShield size={18} />}>
          <OperationForm fields={[['spender','Operador','gameEngine'],['amount','Límite','50']]} button="Autorizar" busy={busy === 'approve'} onSubmit={(data) => run('approve', () => candy.approve(data.spender, parseUnits(data.amount, decimals)), 'Autorización actualizada.')} />
        </ActionCard>}

        {user.role === 'admin' && <ActionCard title="Consultar autorización" description="Revisá el límite disponible entre dos cuentas." icon={<IconSearch size={18} />}>
          <OperationForm fields={[['owner','Cuenta','user1'],['spender','Operador','gameEngine']]} button="Consultar" busy={busy === 'allowance'} onSubmit={(data) => run('allowance', async () => setAllowanceResult(await candy.allowance(data.owner, data.spender)), 'Autorización consultada.')} />
          {allowanceResult !== null && <div className="result-box">{formatUnits(allowanceResult, decimals)} {symbol}<small>Disponible para operar</small></div>}
        </ActionCard>}

        {user.role === 'admin' && <ActionCard title="Transferencia delegada" description="Mové fichas en nombre de una cuenta autorizada." icon={<IconRepeat size={18} />}>
          <OperationForm fields={[['from','Desde','user2'],['to','Hacia','user1'],['amount','Cantidad','10']]} button="Transferir por cuenta" busy={busy === 'transferFrom'} onSubmit={(data) => run('transferFrom', () => candy.transferFrom(data.from, data.to, parseUnits(data.amount, decimals)), 'Transferencia delegada realizada.')} />
        </ActionCard>}
      </section>

      <section className="game-banner">
        <div className="game-banner-glyph"><ChipMark size={220} /></div>
        <div><span className="eyebrow">Partida destacada</span><h2>Desafiá a la máquina</h2><p>Elegí tu apuesta y enfrentate a la máquina. Cada tirada es verificable y el resultado se define de forma transparente.</p></div>
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
          <ActionCard title="Emitir fichas" icon={<IconPlusCircle size={18} />}><OperationForm fields={[['to','Usuario','user1'],['amount','Cantidad','100']]} button="Emitir" busy={busy === 'mint'} onSubmit={(data) => run('mint', () => candy.mint(data.to, parseUnits(data.amount, decimals)), 'Emisión realizada.')} /></ActionCard>
          <ActionCard title="Retirar fichas" icon={<IconMinusCircle size={18} />}><OperationForm fields={[['from','Usuario','user1'],['amount','Cantidad','10']]} button="Retirar" busy={busy === 'burn'} onSubmit={(data) => run('burn', () => candy.burn(data.from, parseUnits(data.amount, decimals)), 'Retiro realizado.')} /></ActionCard>
          <ActionCard title="Control de operaciones" description="Restringe las consultas y transferencias a cuentas autorizadas." icon={gateEnabled ? <IconLock size={18} /> : <IconUnlock size={18} />}>
            <div className="toggle-row"><div><strong>{gateEnabled ? 'Activado' : 'Desactivado'}</strong><small>{gateEnabled ? 'Sólo las cuentas autorizadas pueden operar.' : 'Todas las cuentas habilitadas pueden operar.'}</small></div><button className={`switch ${gateEnabled ? 'on' : ''}`} onClick={() => run('gate', async () => { const r = await candy.setOnlyOwnerOrAllowed(!gateEnabled); setGateEnabled(r.enabled); }, 'Configuración actualizada.')}><span /></button></div>
          </ActionCard>
        </div>
      </section>}

      <section className="events-section"><div className="section-title"><span className="eyebrow">Historial</span><h2>Movimientos de la mesa</h2></div><div className="events-list">
        {events.map((event) => <div className="event-row" key={event.id}><span className={`event-type ${event.event_type.toLowerCase()}`}>{EVENT_ICONS[event.event_type] || <IconInfo size={13} />}<span>{eventTypeLabel(event.event_type)}</span></span><div><strong>{event.from_username || 'Mesa'} → {event.to_username || event.spender_username || 'Mesa'}</strong><small>{formatUnits(BigInt(event.amount), decimals)} {symbol} · realizado por {event.actor_username || 'la mesa'}</small></div><time>{new Date(event.created_at).toLocaleString()}</time></div>)}
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

const PIP_LAYOUT = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Dice({ value, rolling, label, side }) {
  const pips = value ? PIP_LAYOUT[value] : [];
  return <div className={`die die--${side} ${rolling ? 'is-rolling' : ''}`}>
    <div className="die-face">
      {Array.from({ length: 9 }, (_, i) => <span key={i} className={`pip ${pips.includes(i) ? 'on' : ''}`} />)}
      {!value && !rolling && <span className="die-query">?</span>}
    </div>
    <small>{label}</small>
  </div>;
}

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
    <div className="commitment">
      <span className="commitment-icon"><IconShield size={17} /></span>
      <div className="commitment-body"><span>Sello de imparcialidad de la partida</span><code>{game.commitmentHash}</code></div>
    </div>
    <div className="stake-pill">Apuesta: {formatUnits(BigInt(game.stake), decimals)} {config.token.symbol}</div>

    <div className="dice-stage">
      <Dice side="engine" value={resolved ? game.engineDie : null} rolling={rolling} label="La máquina" />
      <div className="versus">VS</div>
      <Dice side="player" value={resolved ? game.playerDie : null} rolling={rolling} label={user.username} />
    </div>

    {!resolved ? <div className="game-controls"><Field label="Número de la máquina" value={engineNumber} onChange={(event) => setEngineNumber(event.target.value)} inputMode="numeric" /><Field label="Tu número" value={playerNumber} onChange={(event) => setPlayerNumber(event.target.value)} inputMode="numeric" /><Button busy={rolling} onClick={play}>Tirar los dados</Button></div> : <div className={`game-result ${game.winner === 'player' ? 'win' : 'lose'}`}>
      <span className="result-icon">{game.winner === 'player' ? <IconCheck size={22} /> : <IconX size={22} />}</span>
      <strong>{game.winner === 'player' ? '¡Ganaste la partida!' : 'La máquina se lleva la ronda'}</strong><span>{game.playerDie} contra {game.engineDie}{game.playerDie === game.engineDie ? ' · los empates favorecen a la máquina' : ''}</span>
    </div>}
    <Notice type="error">{error}</Notice>

    <details className="formula"><summary>Ver imparcialidad de la partida</summary><code>commitment = {game.formula.commitment}</code><code>engineDie = {game.formula.engineDie}</code><code>playerDie = {game.formula.playerDie}</code><code>{game.formula.winner}</code></details>
    {resolved && <div className="reveal"><h3>Comprobación de la ronda</h3><div><span>Secreto revelado</span><code>{game.secret}</code></div><div><span>Salt</span><code>{game.salt}</code></div><div><span>Resultado verificado en tu navegador</span><strong>{verified === null ? 'Verificando…' : verified ? '✓ Partida válida' : '✕ No coincide'}</strong></div></div>}
  </section></main>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { candy.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="splash"><div className="splash-mark"><ChipMark size={64} /></div></div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  return <Routes><Route path="/" element={<Dashboard user={user} onLogout={() => setUser(null)} />} /><Route path="/game/:gameId" element={<GamePage user={user} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
