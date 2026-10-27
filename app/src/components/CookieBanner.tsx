import { useEffect, useState } from 'react';
import { getPlatform, IS_NATIVE } from '../lib/platform';
import { cookieChoice, setCookieChoice } from '../lib/tracking';

/** Aviso de cookies do site (LGPD). Só aparece quando há pixel de anúncio configurado e a pessoa ainda não escolheu. */
export function CookieBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (IS_NATIVE || !location.protocol.startsWith('http')) return;
    const check = () => {
      if (cookieChoice()) { setShow(false); return; }
      getPlatform().then((p) => setShow(!!(p.metaPixelId || p.googleTagId))).catch(() => undefined);
    };
    check();
    window.addEventListener('vision-cookies', check);
    return () => window.removeEventListener('vision-cookies', check);
  }, []);
  if (!show) return null;
  return (
    <div className="cookie-bar" role="dialog" aria-label="Aviso de cookies">
      <p>Usamos cookies para medir os nossos anúncios (Meta e Google). Você escolhe se aceita. Veja a <a href="/privacidade">Política de privacidade</a>.</p>
      <div className="cookie-btns">
        <button type="button" className="v-btn" onClick={() => setCookieChoice('nao')}>Recusar</button>
        <button type="button" className="v-btn primary" onClick={() => setCookieChoice('sim')}>Aceitar</button>
      </div>
    </div>
  );
}

/** Link para mudar a escolha depois (fica no rodapé). */
export function CookieSettingsLink() {
  return <a href="#cookies" onClick={(e) => { e.preventDefault(); setCookieChoice(null); }}>Cookies</a>;
}
