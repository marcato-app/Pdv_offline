import { useState } from 'react';
import { applyUpdate, checkForUpdate, useUpdate, APP_VERSION } from '../lib/update';
import { IS_STORE_APP } from '../lib/store';

/** Faixa "Nova versão disponível". No caixa só aparece com o caixa livre, para não atrapalhar a venda. */
export function UpdateBanner() {
  const v = useUpdate();
  const [busy, setBusy] = useState(false);
  // No app das lojas, as atualizações chegam pela própria loja.
  if (!v || IS_STORE_APP) return null;
  return (
    <div className="spread" style={{ background: 'var(--primary-soft)', color: 'var(--primary-dark)', borderRadius: 16, padding: '10px 16px', fontWeight: 700, fontSize: 14 }}>
      <span>Nova versão do Vision PDV disponível</span>
      <button className="btn sm primary" disabled={busy} onClick={() => { setBusy(true); applyUpdate(); }}>{busy ? 'Atualizando…' : 'Atualizar agora'}</button>
    </div>
  );
}

export function UpdatePanel() {
  const v = useUpdate();
  const [msg, setMsg] = useState('');
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 18 }}>Atualizações</h2>
      <div className="grid">
        <div className="stat"><span className="muted small">Versão deste aparelho</span><b style={{ fontSize: 18 }}>{APP_VERSION}</b></div>
        <div className="stat"><span className="muted small">Situação</span><b style={{ fontSize: 18 }}>{v ? `Nova versão: ${v}` : 'Atualizado'}</b></div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>O sistema procura atualizações sozinho a cada 5 minutos. Os dados do aparelho não são apagados ao atualizar.</p>
      <div className="row">
        <button className="btn" onClick={async () => { setMsg('Procurando…'); const n = await checkForUpdate(); setMsg(n ? 'Encontrada uma versão nova' : 'Você já está na versão mais nova'); }}>Procurar atualização</button>
        <button className="btn primary" onClick={() => applyUpdate()}>{v ? 'Atualizar agora' : 'Recarregar o sistema'}</button>
      </div>
      {msg && <span className="chip">{msg}</span>}
    </div>
  );
}
