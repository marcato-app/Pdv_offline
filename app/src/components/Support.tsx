import { useEffect, useState } from 'react';
import { getPlatform, whatsLink } from '../lib/platform';
import { useApp } from '../lib/app-context';
import { WaIcon } from '../pages/Landing';

/** Link do WhatsApp do suporte, já com o nome da loja na mensagem (null se não configurado). */
export function useSupportLink() {
  const { store } = useApp();
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => { getPlatform().then((p) => setPhone(p.supportWhatsApp)); }, []);
  return phone ? whatsLink(phone, `Olá! Preciso de ajuda com o Vision PDV. Loja: ${store.name}.`) : null;
}

export function SupportFab() {
  const link = useSupportLink();
  if (!link) return null;
  return <a className="wa-float" href={link} target="_blank" rel="noreferrer" aria-label="Suporte no WhatsApp" title="Suporte no WhatsApp"><WaIcon /></a>;
}
