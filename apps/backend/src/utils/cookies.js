export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index < 0
          ? [decodeURIComponent(part), '']
          : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

export function sessionCookie(token) {
  const secure = process.env.COOKIE_SECURE === 'true';
  return [
    `candy_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=604800',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie() {
  return 'candy_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}
