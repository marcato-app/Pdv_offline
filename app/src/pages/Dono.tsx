import { useEffect, useState } from 'react';
import { api } from '../lib/store';
import { dateOnly, dateTime } from '../lib/format';
import { STATUS_LABEL, type License } from '../lib/license';
import * as XLSX from 'xlsx';
import { readWorkbook } from '../lib/sheet';
import { guessMap, cell, type FieldKey } from './admin/Importar';

// Painel do dono do Vision PDV: ver lojas, gerar chaves de ativação e dar dias.
// Abre em visionpdv.marcatoapp.com.br/dono e pede a chave mestra.

type StoreInfo = License & { id: string; name: string; email: string | null; phone: string | null; createdAt: number; blocked: boolean };
interface Key { code: string; days: number; note: string | null; created_at: number; used_by: string | null; used_at: number | null }

export function Dono() {
  const [master, setMaster] = useState(() => sessionStorage.getItem('vision-master') || '');
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<'lojas' | 'chaves' | 'produtos' | 'plataforma'>('lojas');
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(30);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const [q, setQ] = useState('');

  const load = async (m = master) => {
    setErr('');
    try {
      const [s, k] = await Promise.all([
        api<{ stores: StoreInfo[] }>('/api/admin/stores', { master: m }),
        api<{ keys: Key[] }>('/api/admin/keys', { master: m }),
      ]);
      setStores(s.stores);
      setKeys(k.keys);
      setOk(true);
      sessionStorage.setItem('vision-master', m);
    } catch (e) {
      setOk(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { if (master) load(); }, []);

  const extend = async (slug: string, d: number) => {
    await api('/api/admin/extend', { method: 'POST', master, body: JSON.stringify({ slug, days: d }) });
    load();
  };
  const block = async (slug: string, blocked: boolean) => {
    if (!confirm(blocked ? 'Bloquear esta loja?' : 'Desbloquear esta loja?')) return;
    await api('/api/admin/block', { method: 'POST', master, body: JSON.stringify({ slug, blocked }) });
    load();
  };
  const generate = async () => {
    const r = await api<{ codes: string[] }>('/api/admin/keys', { method: 'POST', master, body: JSON.stringify({ days, count, note }) });
    setFresh(r.codes);
    load();
  };

  if (!ok) {
    return (
      <div className="login">
        <div className="login-brand"><span style={{ fontSize: 24, fontWeight: 800 }}>Vision PDV · Painel do dono</span></div>
        <div className="login-form">
          <form onSubmit={(e) => { e.preventDefault(); load(); }}>
            <h2 style={{ fontSize: 24 }}>Painel do dono</h2>
            <div className="field"><label htmlFor="mk">Chave mestra</label><input id="mk" type="password" autoComplete="off" value={master} onChange={(e) => setMaster(e.target.value)} /></div>
            {err && <div className="error">{err}</div>}
            <button className="btn primary big">Entrar</button>
          </form>
        </div>
      </div>
    );
  }

  const shown = stores.filter((s) => !q || (s.name + s.id + (s.email || '') + (s.phone || '')).toLowerCase().includes(q.toLowerCase()));
  const count_ = (st: string) => stores.filter((s) => s.status === st).length;

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1300, margin: '0 auto' }}>
      <div className="page-head">
        <h1>Painel do dono</h1>
        <div className="row">
          <button className={'btn sm ' + (tab === 'lojas' ? 'secondary' : '')} onClick={() => setTab('lojas')}>Lojas</button>
          <button className={'btn sm ' + (tab === 'chaves' ? 'secondary' : '')} onClick={() => setTab('chaves')}>Chaves de ativação</button>
          <button className={'btn sm ' + (tab === 'produtos' ? 'secondary' : '')} onClick={() => setTab('produtos')}>Banco de produtos</button>
          <button className={'btn sm ' + (tab === 'plataforma' ? 'secondary' : '')} onClick={() => setTab('plataforma')}>Planos e pagamento</button>
          <button className="btn sm ghost" onClick={() => { sessionStorage.removeItem('vision-master'); setOk(false); setMaster(''); }}>Sair</button>
        </div>
      </div>
      <div className="grid">
        <div className="stat"><span className="muted small">Lojas</span><b>{stores.length}</b></div>
        <div className="stat"><span className="muted small">Em teste grátis</span><b>{count_('trial')}</b></div>
        <div className="stat" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}><span className="small">Pagantes</span><b>{count_('active')}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">Vencidas</span><b>{count_('expired')}</b></div>
      </div>

      {tab === 'lojas' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" placeholder="Buscar por nome, código, e-mail ou WhatsApp" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="table-wrap">
            <table className="t" style={{ minWidth: 900 }}>
              <thead><tr><th>Loja</th><th>Contato</th><th>Criada</th><th>Situação</th><th>Válida até</th><th></th></tr></thead>
              <tbody>{shown.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b><br /><span className="muted small">{s.id}</span></td>
                  <td className="small">{s.email}<br />{s.phone && <a href={`https://wa.me/55${s.phone.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noreferrer">{s.phone}</a>}</td>
                  <td className="small">{dateTime(s.createdAt)}</td>
                  <td><span className={'chip ' + (s.status === 'active' ? 'ok' : s.status === 'trial' ? '' : 'danger')}>{STATUS_LABEL[s.status]}</span></td>
                  <td className="small">{dateOnly(s.validUntil)} ({s.daysLeft} d)</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => extend(s.id, 7)}>+7 dias</button>{' '}
                    <button className="btn sm" onClick={() => extend(s.id, 30)}>+30 dias</button>{' '}
                    <button className="btn sm danger" onClick={() => block(s.id, !s.blocked)}>{s.blocked ? 'Desbloquear' : 'Bloquear'}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!shown.length && <div className="empty">Nenhuma loja</div>}
          </div>
        </div>
      )}

      {tab === 'produtos' && <CatalogUpload master={master} />}
      {tab === 'plataforma' && <PlatformCfg master={master} />}

      {tab === 'chaves' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label htmlFor="kd">Dias</label>
              <select id="kd" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={30}>30 dias (mensal)</option><option value={90}>90 dias (trimestral)</option><option value={180}>180 dias</option><option value={365}>365 dias (anual)</option>
              </select>
            </div>
            <div className="field" style={{ width: 110 }}><label htmlFor="kc">Quantidade</label><input id="kc" className="input" inputMode="numeric" value={count} onChange={(e) => setCount(Number(e.target.value.replace(/\D/g, '')) || 1)} /></div>
            <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="kn">Anotação (opcional)</label><input id="kn" className="input" placeholder="ex.: venda para João" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <button className="btn primary" onClick={generate}>Gerar chaves</button>
          </div>
          {fresh.length > 0 && (
            <div className="stat" style={{ background: 'var(--ok-bg)' }}>
              <span className="small" style={{ color: 'var(--ok)' }}>Chaves novas (copie e envie para o cliente):</span>
              <pre style={{ margin: 0, fontSize: 16, whiteSpace: 'pre-wrap' }}>{fresh.join('\n')}</pre>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(fresh.join('\n'))}>Copiar</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="t" style={{ minWidth: 700 }}>
              <thead><tr><th>Chave</th><th>Dias</th><th>Anotação</th><th>Criada</th><th>Usada por</th></tr></thead>
              <tbody>{keys.map((k) => (
                <tr key={k.code}><td style={{ fontFamily: 'monospace' }}>{k.code}</td><td>{k.days}</td><td className="small">{k.note}</td><td className="small">{dateOnly(k.created_at)}</td>
                  <td>{k.used_by ? <span className="chip">{k.used_by} · {dateOnly(k.used_at!)}</span> : <span className="chip ok">Disponível</span>}</td></tr>
              ))}</tbody>
            </table>
            {!keys.length && <div className="empty">Nenhuma chave gerada</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Sobe a planilha de produtos (código de barras, descritivo, marca…) para o banco compartilhado. */
function CatalogUpload({ master }: { master: string }) {
  const [stats, setStats] = useState<{ total: number; withPhoto: number } | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [map, setMap] = useState<Partial<Record<FieldKey, string>>>({});
  const [progress, setProgress] = useState('');
  const load = () => api<{ total: number; withPhoto: number }>('/api/admin/catalog', { master }).then(setStats).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const onFile = async (f: File) => {
    const book = await readWorkbook(f);
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '', raw: true });
    setRows(data);
    setMap(guessMap(data.length ? Object.keys(data[0]) : []));
  };
  const get = (r: Record<string, unknown>, k: FieldKey) => (map[k] ? cell(r[map[k]!]) : '');
  const send = async () => {
    const items = rows.map((r) => ({
      barcode: get(r, 'barcode').replace(/\.0+$/, ''), description: get(r, 'description'), brand: get(r, 'brand'), manufacturer: get(r, 'manufacturer'),
      basket: get(r, 'basket'), segment: get(r, 'segment'), department: get(r, 'department'), category: get(r, 'category'), subcategory: get(r, 'subcategory'), family: get(r, 'family'), content: get(r, 'content'), ncm: get(r, 'ncm'),
    })).filter((x) => x.barcode && x.description);
    let done = 0;
    for (let i = 0; i < items.length; i += 1000) {
      const r = await api<{ accepted: number }>('/api/admin/catalog', { method: 'POST', master, body: JSON.stringify({ items: items.slice(i, i + 1000) }) });
      done += r.accepted;
      setProgress(`Enviando… ${Math.min(items.length, i + 1000)} de ${items.length}`);
    }
    setProgress(`Pronto: ${done} produtos no banco`);
    load();
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 18 }}>Banco de produtos compartilhado</h2>
      <p className="muted small" style={{ margin: 0 }}>Quando qualquer loja digita ou bipa um código de barras novo, o sistema preenche nome, marca, categoria e NCM sozinho usando este banco. Ele cresce com a sua planilha, com os cadastros das lojas e com bases públicas de produtos.</p>
      {stats && <div className="grid"><div className="stat"><span className="muted small">Produtos no banco</span><b>{stats.total.toLocaleString('pt-BR')}</b></div><div className="stat"><span className="muted small">Com foto</span><b>{stats.withPhoto.toLocaleString('pt-BR')}</b></div></div>}
      <label className="btn primary" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>Escolher planilha (.xlsx, .csv)<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
      {rows.length > 0 && (
        <>
          <span className="chip">{rows.length} linhas · colunas reconhecidas: {Object.entries(map).map(([k, v]) => `${v} → ${k}`).join(', ') || 'nenhuma'}</span>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!map.barcode || !map.description} onClick={send}>Enviar para o banco</button>
        </>
      )}
      {progress && <span className="chip ok">{progress}</span>}
    </div>
  );
}

interface PlanRow { id: string; name: string; price: number; days: number; highlight?: string }
type TextKey = 'mpPublicKey' | 'supportWhatsApp' | 'company' | 'companyDoc' | 'companyEmail' | 'mailFrom' | 'zapiInstance' | 'metaPixelId' | 'googleTagId' | 'googleAdsSignup' | 'googleAdsPurchase';
type SecretKey = 'mpToken' | 'resendKey' | 'zapiToken' | 'zapiClientToken';
type PlatformAdmin = { plans: PlanRow[]; checkout: boolean } & Record<TextKey | SecretKey, string | null>;
const TEXT_FIELDS: TextKey[] = ['mpPublicKey', 'supportWhatsApp', 'company', 'companyDoc', 'companyEmail', 'mailFrom', 'zapiInstance', 'metaPixelId', 'googleTagId', 'googleAdsSignup', 'googleAdsPurchase'];

/** Planos, preço, conta Mercado Pago que recebe as assinaturas, WhatsApp do suporte e dados da empresa (vão nos termos). */
function PlatformCfg({ master }: { master: string }) {
  const [p, setP] = useState<PlatformAdmin | null>(null);
  const [sec, setSec] = useState<Partial<Record<SecretKey, string>>>({});
  const [testTo, setTestTo] = useState({ email: '', phone: '' });
  const [testMsg, setTestMsg] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api<PlatformAdmin>('/api/admin/platform', { master }).then(setP).catch((e) => setMsg(String(e.message || e))); }, []);
  if (!p) return <div className="card">{msg || 'Carregando…'}</div>;
  const setPlan = (i: number, k: keyof PlanRow, v: string) => setP({ ...p, plans: p.plans.map((x, j) => (j === i ? { ...x, [k]: k === 'price' || k === 'days' ? Number(v.replace(',', '.')) : v } : x)) });
  const save = async () => {
    setMsg('');
    try {
      const body: Record<string, unknown> = { plans: p.plans, ...sec };
      for (const k of TEXT_FIELDS) body[k] = p[k] || '';
      const r = await api<PlatformAdmin>('/api/admin/platform', { method: 'PUT', master, body: JSON.stringify(body) });
      setP(r); setSec({}); setMsg('Salvo!');
      localStorage.removeItem('vision-platform');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const secret = (id: string, label: string, k: SecretKey, ph = '') => (
    <div className="field"><label htmlFor={id}>{label}{p[k] ? ` (salvo: ${p[k]})` : ''}</label><input id={id} className="input" type="password" autoComplete="off" placeholder={p[k] ? 'deixe vazio para manter' : ph} value={sec[k] || ''} onChange={(e) => setSec({ ...sec, [k]: e.target.value })} /></div>
  );
  const test = async () => {
    setTestMsg('Enviando…');
    try {
      const r = await api<Record<string, string>>('/api/admin/notify-test', { method: 'POST', master, body: JSON.stringify(testTo) });
      setTestMsg(Object.entries(r).map(([k, v]) => `${k === 'email' ? 'E-mail' : 'WhatsApp'}: ${v}`).join(' · ') || 'Informe um e-mail ou número');
    } catch (e) { setTestMsg(e instanceof Error ? e.message : String(e)); }
  };
  const txt = (id: string, label: string, k: TextKey, ph = '') => (
    <div className="field"><label htmlFor={id}>{label}</label><input id={id} className="input" placeholder={ph} value={p[k] || ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>
  );
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 18 }}>Planos</h2>
      <div className="table-wrap">
        <table className="t" style={{ minWidth: 640 }}>
          <thead><tr><th>Código</th><th>Nome</th><th>Preço (R$)</th><th>Dias</th><th>Destaque</th><th /></tr></thead>
          <tbody>
            {p.plans.map((pl, i) => (
              <tr key={i}>
                <td><input className="input" aria-label="Código" value={pl.id} onChange={(e) => setPlan(i, 'id', e.target.value)} /></td>
                <td><input className="input" aria-label="Nome" value={pl.name} onChange={(e) => setPlan(i, 'name', e.target.value)} /></td>
                <td><input className="input" aria-label="Preço" inputMode="decimal" value={String(pl.price)} onChange={(e) => setPlan(i, 'price', e.target.value)} /></td>
                <td><input className="input" aria-label="Dias" inputMode="numeric" value={String(pl.days)} onChange={(e) => setPlan(i, 'days', e.target.value)} /></td>
                <td><input className="input" aria-label="Destaque" placeholder="ex.: 2 meses grátis" value={pl.highlight || ''} onChange={(e) => setPlan(i, 'highlight', e.target.value)} /></td>
                <td><button className="btn sm danger" onClick={() => setP({ ...p, plans: p.plans.filter((_, j) => j !== i) })}>Tirar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setP({ ...p, plans: [...p.plans, { id: 'novo', name: 'Novo', price: 99, days: 30 }] })}>+ Plano</button>

      <h2 style={{ fontSize: 18 }}>Recebimento (Mercado Pago)</h2>
      <p className="muted small" style={{ margin: 0 }}>Cole o Access Token de produção da SUA conta Mercado Pago (Seu negócio → Configurações → Credenciais). As assinaturas caem nela e as lojas são ativadas sozinhas. Situação: <b>{p.checkout ? 'ligado' : 'desligado'}</b>.</p>
      <div className="grid">
        {secret('pmt', 'Access Token', 'mpToken', 'APP_USR-…')}
        {txt('ppk', 'Public Key (cartão dentro do app)', 'mpPublicKey', 'APP_USR-…')}
      </div>
      <p className="muted small" style={{ margin: 0 }}>No Mercado Pago, em Suas integrações → Webhooks, cadastre a URL <b>https://visionpdv.marcatoapp.com.br/api/billing/webhook</b> com os eventos Pagamentos, Planos e assinaturas.</p>

      <h2 style={{ fontSize: 18 }}>E-mail e WhatsApp da plataforma</h2>
      <p className="muted small" style={{ margin: 0 }}>Usados no "Esqueci minha senha" e nos avisos de vencimento (3 dias antes, no dia e 1 dia depois, às 9h). E-mail pelo <b>Resend</b> (resend.com, grátis até 3.000/mês: verifique o domínio marcatoapp.com.br lá). WhatsApp pela <b>Z-API</b> (z-api.io).</p>
      <div className="grid">
        {secret('prk', 'Chave do Resend', 'resendKey', 're_…')}
        {txt('pmf', 'Remetente', 'mailFrom', 'Vision PDV <nao-responda@marcatoapp.com.br>')}
        {txt('pzi', 'Z-API: ID da instância', 'zapiInstance')}
        {secret('pzt', 'Z-API: token da instância', 'zapiToken')}
        {secret('pzc', 'Z-API: Client-Token (segurança)', 'zapiClientToken')}
      </div>
      <div className="row">
        <input className="input" style={{ flex: '1 1 200px' }} placeholder="e-mail para teste" aria-label="E-mail para teste" value={testTo.email} onChange={(e) => setTestTo({ ...testTo, email: e.target.value })} />
        <input className="input" style={{ flex: '1 1 160px' }} placeholder="WhatsApp para teste" aria-label="WhatsApp para teste" value={testTo.phone} onChange={(e) => setTestTo({ ...testTo, phone: e.target.value })} />
        <button className="btn" onClick={test}>Enviar teste</button>
        {testMsg && <span className="chip">{testMsg}</span>}
      </div>
      <span className="muted small">Salve antes de testar.</span>

      <h2 style={{ fontSize: 18 }}>Anúncios (medir cadastros e vendas)</h2>
      <p className="muted small" style={{ margin: 0 }}>Os pixels carregam só no site (página de vendas e cadastro), nunca dentro do caixa. Eventos enviados: visita, cadastro (CompleteRegistration / sign_up) e assinatura paga (Purchase / purchase).</p>
      <div className="grid">
        {txt('pfb', 'Pixel da Meta (Facebook/Instagram)', 'metaPixelId', '123456789012345')}
        {txt('pga', 'Google: ID da tag', 'googleTagId', 'G-XXXX ou AW-XXXX')}
        {txt('pgs', 'Google Ads: conversão de cadastro', 'googleAdsSignup', 'AW-XXXX/abcDEF')}
        {txt('pgp', 'Google Ads: conversão de assinatura', 'googleAdsPurchase', 'AW-XXXX/ghiJKL')}
      </div>

      <h2 style={{ fontSize: 18 }}>Suporte e empresa</h2>
      <div className="grid">
        {txt('psw', 'WhatsApp do suporte (com DDD)', 'supportWhatsApp', '11 99999-9999')}
        {txt('pco', 'Nome da empresa (termos)', 'company')}
        {txt('pcd', 'CNPJ ou CPF', 'companyDoc')}
        {txt('pce', 'E-mail de contato', 'companyEmail')}
      </div>
      <div className="row"><button className="btn primary" onClick={save}>Salvar</button>{msg && <span className="chip">{msg}</span>}</div>
    </div>
  );
}
