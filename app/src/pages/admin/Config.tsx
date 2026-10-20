import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDevice, setDevice, getSetting, setSetting, db, uid, type Sale } from '../../lib/db';
import { DEFAULT_THEME, PRIMARY_OPTIONS, SECONDARY_OPTIONS, applyTheme, resizeImage, type StoreInfo, type Theme } from '../../lib/theme';
import { DEFAULT_SCALE, DEFAULT_QUICK_ITEMS, type ScaleConfig, type QuickItem } from '../../lib/pdv';
import { ACTION_LABELS, DEFAULT_PERMISSIONS, type Action, type Permissions } from '../../lib/permissions';
import { DEFAULT_SCALE_SETTINGS, getScaleSettings, setScaleSettings, pickScalePort, readWeight, scaleSupported, type ScaleSettings } from '../../lib/scale';
import { receiptHtml, printHtml } from '../../lib/receipt';
import { dec2, parseNum } from '../../lib/format';
import { syncNow, testConnection } from '../../lib/sync';
import { STORE_SLUG, storeLink } from '../../lib/store';
import { makeBackup, listBackups, readBackup, importData, exportData, downloadText, desktop } from '../../lib/backup';
import { dateTime } from '../../lib/format';
import { useApp } from '../../lib/app-context';
import { useLicense, refreshLicense } from '../../lib/license';
import { ActivateBox, LicenseSummary } from '../../components/license';
import { Logo, SyncBadge } from '../../components/ui';
import { loadPayConfig, saveSecrets, payApi, type PayConfig } from '../../lib/payments';
import { pixCode, type PixKey, type PixKeyType } from '../../lib/pix';
import QRCode from 'qrcode';
import { UpdatePanel } from '../../components/UpdateBanner';

const TABS = { assinatura: 'Assinatura', loja: 'Loja e aparência', cupom: 'Cupom', pagamentos: 'Pagamentos (PIX e maquininha)', whatsapp: 'WhatsApp', permissoes: 'Senhas e permissões', atualizacoes: 'Atualizações', caixa: 'Caixa, impressora e balança', nuvem: 'Nuvem', backup: 'Backup' } as const;

export function Config() {
  const initial = new URLSearchParams(location.search).get('aba') as keyof typeof TABS | null;
  const [tab, setTab] = useState<keyof typeof TABS>(initial && initial in TABS ? initial : 'loja');
  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>
      <div className="row">{(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => <button key={k} className={'btn sm ' + (tab === k ? 'secondary' : '')} onClick={() => setTab(k)}>{TABS[k]}</button>)}</div>
      {tab === 'assinatura' && <Assinatura />}
      {tab === 'loja' && <Loja />}
      {tab === 'cupom' && <Cupom />}
      {tab === 'pagamentos' && <Pagamentos />}
      {tab === 'whatsapp' && <WhatsApp />}
      {tab === 'atualizacoes' && <UpdatePanel />}
      {tab === 'permissoes' && <Permissoes />}
      {tab === 'caixa' && <><CaixaCfg /><SerialScaleCfg /><QuickItemsCfg /></>}
      {tab === 'nuvem' && <Nuvem />}
      {tab === 'backup' && <Backup />}
    </>
  );
}

function Assinatura() {
  const lic = useLicense();
  useEffect(() => { refreshLicense(); }, []);
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2 style={{ fontSize: 18 }}>Assinatura do Vision PDV</h2>
      <LicenseSummary lic={lic || null} />
      <ActivateBox lic={lic || null} />
      <p className="muted small" style={{ margin: 0 }}>Ao comprar, você recebe uma chave de ativação. Ela soma os dias à sua loja, inclusive se ainda estiver no teste grátis.</p>
    </div>
  );
}

function Swatches({ options, value, onChange, label }: { options: string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        {options.map((c) => (
          <button key={c} type="button" aria-label={c} onClick={() => onChange(c)}
            style={{ width: 44, height: 44, borderRadius: 12, background: c, border: value.toLowerCase() === c.toLowerCase() ? '3px solid #1e1b2e' : '3px solid transparent', cursor: 'pointer' }} />
        ))}
        <label className="btn sm" style={{ cursor: 'pointer' }}>Outra cor<input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 0, height: 0, opacity: 0, border: 0, padding: 0 }} /></label>
      </div>
    </div>
  );
}

function Loja() {
  const { store, theme } = useApp();
  const [s, setS] = useState<StoreInfo>(store);
  const [t, setT] = useState<Theme>(theme);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setS(store); }, [store.name]);
  const set = (k: keyof StoreInfo, v: string | undefined) => { setS({ ...s, [k]: v }); setSaved(false); };
  const changeTheme = (nt: Theme) => { setT(nt); applyTheme(nt); setSaved(false); };
  const submit = async () => {
    await setSetting('store', s);
    await setSetting('theme', t);
    setSaved(true);
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div className="photo" style={{ width: 150, height: 150 }}>{s.logo ? <img src={s.logo} alt="Logo" /> : 'Sem logo'}</div>
          <label className="btn sm" style={{ cursor: 'pointer' }}>Enviar logo<input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('logo', await resizeImage(f, 400, 0.9)); }} /></label>
          {s.logo && <button className="btn sm ghost" onClick={() => set('logo', undefined)}>Remover</button>}
        </div>
        <div className="grid" style={{ flex: '1 1 400px' }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="sn">Nome da loja</label><input id="sn" value={s.name} onChange={(e) => set('name', e.target.value)} /></div>
          <p className="muted small" style={{ margin: 0, gridColumn: '1 / -1' }}>CNPJ, endereço e mensagens do cupom ficam na aba <b>Cupom</b>.</p>
        </div>
      </div>
      <h2 style={{ fontSize: 18 }}>Cores do sistema</h2>
      <Swatches label="Cor principal (botões e ações)" options={PRIMARY_OPTIONS} value={t.primary} onChange={(c) => changeTheme({ ...t, primary: c })} />
      <Swatches label="Cor secundária (cabeçalho e menu)" options={SECONDARY_OPTIONS} value={t.secondary} onChange={(c) => changeTheme({ ...t, secondary: c })} />
      <div className="row" style={{ background: 'var(--secondary)', color: '#fff', borderRadius: 16, padding: 14 }}>
        <Logo /><b>{s.name}</b><span style={{ marginLeft: 'auto' }} /><button className="btn primary">Botão de exemplo</button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {saved && <span className="chip ok">Salvo</span>}
        <button className="btn" onClick={() => changeTheme(DEFAULT_THEME)}>Voltar às cores Vision</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </div>
  );
}

const SAMPLE_SALE: Sale = {
  id: 'exemplo', updatedAt: 0, deleted: 0, number: '01-000123', sessionId: '', operatorId: '', operatorName: 'Maria',
  items: [
    { productId: 'a', barcode: '7890000000017', description: 'Arroz Branco Tipo 1 5kg', unit: 'UN', qty: 1, unitPrice: 27.9, total: 27.9 },
    { productId: 'b', barcode: '7890000000031', description: 'Leite Integral 1L', unit: 'UN', qty: 6, unitPrice: 4.79, total: 28.74 },
    { productId: 'c', barcode: '2000000000022', description: 'Banana Prata', unit: 'KG', qty: 1.235, unitPrice: 6.99, total: 8.63 },
  ],
  subtotal: 65.27, discount: 0, total: 65.27, payments: [{ method: 'dinheiro', amount: 70 }], change: 4.73, status: 'completed', createdAt: Date.now(),
};

function Cupom() {
  const { store } = useApp();
  const [s, setS] = useState<StoreInfo>(store);
  const [html, setHtml] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setS(store); }, [store.name]);
  useEffect(() => { receiptHtml(SAMPLE_SALE, s).then(setHtml); }, [s]);
  const set = (k: keyof StoreInfo, v: string | boolean | undefined) => { setS({ ...s, [k]: v }); setSaved(false); };
  const F = (k: keyof StoreInfo, label: string, full = false, ph = '') => (
    <div className="field" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={'cp-' + k}>{label}</label>
      <input id={'cp-' + k} placeholder={ph} value={(s[k] as string) || ''} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
      <div className="card" style={{ flex: '2 1 420px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18 }}>Dados que saem no cupom</h2>
        <div className="grid">
          {F('name', 'Nome fantasia', true)}
          {F('legalName', 'Razão social', true)}
          {F('cnpj', 'CNPJ')}
          {F('ie', 'Inscrição estadual')}
          {F('address', 'Endereço', true, 'Rua, número, bairro')}
          {F('city', 'Cidade / UF', false, 'São Paulo / SP')}
          {F('phone', 'Telefone / WhatsApp')}
          {F('receiptHeader', 'Mensagem no topo', true, 'ex.: Promoção de hortifruti toda quarta!')}
          {F('receiptFooter', 'Mensagem no fim', true, 'Obrigado pela preferência!')}
        </div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={s.receiptShowLogo !== false} onChange={(e) => set('receiptShowLogo', e.target.checked)} />Imprimir o logo da loja</label>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={!!s.receiptShowBarcode} onChange={(e) => set('receiptShowBarcode', e.target.checked)} />Mostrar o código de barras de cada item</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {saved && <span className="chip ok">Salvo</span>}
          <button className="btn" onClick={() => printHtml(html)}>Imprimir teste</button>
          <button className="btn primary" onClick={async () => { await setSetting('store', s); setSaved(true); }}>Salvar</button>
        </div>
      </div>
      <div className="card" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <span className="label">Prévia</span>
        <iframe title="Prévia do cupom" srcDoc={html} style={{ width: 320, height: 560, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
      </div>
    </div>
  );
}

function Pagamentos() {
  const [cfg, setCfg] = useState<PayConfig | null>(null);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [devices, setDevices] = useState<{ id: string; mode: string }[] | null>(null);
  const [msg, setMsg] = useState('');
  const [pix, setPix] = useState<PixKey>({ type: 'cnpj', key: '', name: '', city: '' });
  const [qr, setQr] = useState('');
  const { store } = useApp();
  useEffect(() => {
    loadPayConfig().then((c) => { setCfg(c); setEmail(c?.pixPayerEmail || ''); });
    getSetting<PixKey | null>('pixKey', null).then((k) => k && setPix(k));
  }, []);
  useEffect(() => { if (pix.key) QRCode.toDataURL(pixCode({ ...pix, name: pix.name || store.name, city: pix.city || 'BRASIL' }, 1), { width: 160, margin: 1 }).then(setQr); else setQr(''); }, [pix.key, pix.type, pix.name, pix.city]);
  const run = async (fn: () => Promise<void>) => { setMsg(''); try { await fn(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };

  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="spread"><h2 style={{ fontSize: 18 }}>Mercado Pago</h2>{cfg?.mercadoPago ? <span className="chip ok">Conectado {cfg.mpAccessToken}</span> : <span className="chip">Não conectado</span>}</div>
        <p className="muted small" style={{ margin: 0 }}>
          Com o Mercado Pago, o <b>PIX aparece em QR na tela e a venda fecha sozinha</b> quando o cliente paga, e o valor do cartão vai sozinho para a <b>maquininha Point</b>.
          Pegue o <b>Access Token de produção</b> em mercadopago.com.br/developers › Suas integrações › Credenciais. O token fica guardado só no servidor.
        </p>
        <div className="grid">
          <div className="field"><label htmlFor="mpt">Access Token</label><input id="mpt" type="password" autoComplete="off" placeholder={cfg?.mpAccessToken || 'APP_USR-...'} value={token} onChange={(e) => setToken(e.target.value)} /></div>
          <div className="field"><label htmlFor="mpe">E-mail do pagador padrão (opcional)</label><input id="mpe" placeholder="cliente@sualoja.com.br" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => run(async () => { const c = await saveSecrets({ ...(token ? { mpAccessToken: token } : {}), pixPayerEmail: email }); setCfg(c); setToken(''); setMsg('Salvo'); })}>Salvar</button>
          {cfg?.mercadoPago && <button className="btn danger" onClick={() => run(async () => { setCfg(await saveSecrets({ mpAccessToken: '', mpPointDeviceId: '' })); setMsg('Mercado Pago desconectado'); })}>Desconectar</button>}
        </div>
        {cfg?.mercadoPago && (
          <>
            <h3 style={{ fontSize: 16 }}>Maquininha Point</h3>
            <p className="muted small" style={{ margin: 0 }}>A maquininha precisa estar no <b>modo PDV</b> (no app Mercado Pago: Seu negócio › Maquininhas › Point › Modo de operação).</p>
            <div className="row">
              <button className="btn" onClick={() => run(async () => setDevices((await payApi<{ devices: { id: string; mode: string }[] }>('/api/point/devices')).devices))}>Procurar maquininhas</button>
              {cfg.mpPointDeviceId && <span className="chip ok">Usando: {cfg.mpPointDeviceId}</span>}
            </div>
            {devices && !devices.length && <span className="chip warn">Nenhuma maquininha encontrada nesta conta</span>}
            {devices?.map((d) => (
              <div key={d.id} className="spread" style={{ background: 'var(--field)', borderRadius: 12, padding: 10 }}>
                <span>{d.id} · {d.mode === 'PDV' ? 'Modo PDV' : `Modo ${d.mode} (mude para PDV)`}</span>
                <button className="btn sm primary" onClick={() => run(async () => { setCfg(await saveSecrets({ mpPointDeviceId: d.id })); setMsg('Maquininha escolhida'); })}>Usar esta</button>
              </div>
            ))}
          </>
        )}
        {msg && <span className="chip">{msg}</span>}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 18 }}>Chave PIX da loja (sem Mercado Pago)</h2>
        <p className="muted small" style={{ margin: 0 }}>Gera o QR do PIX com o valor da venda na tela, até sem internet. O operador confirma quando o dinheiro cair. Se o Mercado Pago estiver conectado, ele é usado primeiro.</p>
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="grid" style={{ flex: '1 1 380px' }}>
            <div className="field"><label htmlFor="pkt">Tipo de chave</label>
              <select id="pkt" value={pix.type} onChange={(e) => setPix({ ...pix, type: e.target.value as PixKeyType })}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option><option value="telefone">Telefone</option><option value="email">E-mail</option><option value="aleatoria">Chave aleatória</option></select>
            </div>
            <div className="field"><label htmlFor="pkk">Chave</label><input id="pkk" value={pix.key} onChange={(e) => setPix({ ...pix, key: e.target.value })} /></div>
            <div className="field"><label htmlFor="pkn">Nome do recebedor</label><input id="pkn" placeholder={store.name} value={pix.name} onChange={(e) => setPix({ ...pix, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="pkc">Cidade</label><input id="pkc" value={pix.city} onChange={(e) => setPix({ ...pix, city: e.target.value })} /></div>
          </div>
          {qr && <div style={{ textAlign: 'center' }}><img src={qr} alt="QR de teste" style={{ width: 160 }} /><div className="muted small">Teste: R$ 1,00</div></div>}
        </div>
        <div className="row"><button className="btn primary" onClick={async () => { await setSetting('pixKey', pix.key ? { ...pix, name: pix.name || store.name, city: pix.city || 'BRASIL' } : null); setMsg('Chave PIX salva'); }}>Salvar chave PIX</button></div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 18 }}>Outras maquininhas (Rede, Cielo, Stone, PagSeguro, GetNet)</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Essas maquininhas só aceitam receber o valor do caixa por um <b>TEF</b> (programa homologado como PayGo ou SiTef, contratado à parte).
          O Vision PDV está preparado para isso. Enquanto não houver TEF, o operador digita o valor na maquininha e marca a forma de pagamento no caixa.
        </p>
      </div>
    </>
  );
}

function WhatsApp() {
  const [cfg, setCfg] = useState<PayConfig | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState('');
  useEffect(() => { loadPayConfig().then((c) => {
    setCfg(c);
    const w = c?.whatsapp;
    if (w) setF({ provider: w.provider || '', to: (w.to || []).join(', '), hour: String(w.hour ?? 20), metaPhoneId: w.metaPhoneId || '', metaTemplate: w.metaTemplate || '', zapiInstance: w.zapiInstance || '', evolutionUrl: w.evolutionUrl || '', evolutionInstance: w.evolutionInstance || '' });
  }); }, []);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const T = (k: string, label: string, secret = false, ph = '') => (
    <div className="field"><label htmlFor={'wa-' + k}>{label}</label><input id={'wa-' + k} type={secret ? 'password' : 'text'} autoComplete="off" placeholder={ph} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} /></div>
  );
  const run = async (fn: () => Promise<void>) => { setMsg(''); try { await fn(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  const save = () => run(async () => {
    const patch: Record<string, unknown> = { provider: f.provider || undefined, to: (f.to || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), hour: Number(f.hour) || 20 };
    for (const k of ['metaToken', 'metaPhoneId', 'metaTemplate', 'zapiInstance', 'zapiToken', 'zapiClientToken', 'evolutionUrl', 'evolutionKey', 'evolutionInstance']) if (f[k] !== undefined && f[k] !== '') patch[k] = f[k];
    setCfg(await saveSecrets({ whatsapp: patch }));
    setMsg('Salvo');
  });
  const loadPreview = () => run(async () => setPreview((await payApi<{ text: string }>('/api/whatsapp/summary')).text));

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="spread"><h2 style={{ fontSize: 18 }}>Resumo do dia no WhatsApp</h2>{cfg?.whatsapp?.configured ? <span className="chip ok">Envio automático ligado</span> : <span className="chip">Envio automático desligado</span>}</div>
      <p className="muted small" style={{ margin: 0 }}>Todo dia, no horário escolhido, o dono recebe: vendas do dia, comparação com ontem, mais vendidos, produtos acabando, contas vencendo e validade. Para envio automático, escolha um serviço de WhatsApp. Sem serviço, use o botão "Abrir no WhatsApp".</p>
      <div className="grid">
        {T('to', 'Números que recebem (com DDD, separados por vírgula)', false, '11 99999-8888')}
        <div className="field"><label htmlFor="wa-hour">Horário do resumo</label><select id="wa-hour" value={f.hour || '20'} onChange={(e) => set('hour', e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></div>
        <div className="field"><label htmlFor="wa-prov">Serviço de envio</label>
          <select id="wa-prov" value={f.provider || ''} onChange={(e) => set('provider', e.target.value)}>
            <option value="">Nenhum (só manual)</option><option value="zapi">Z-API</option><option value="evolution">Evolution API</option><option value="meta">WhatsApp oficial (Meta)</option>
          </select>
        </div>
      </div>
      {f.provider === 'zapi' && <div className="grid">{T('zapiInstance', 'ID da instância')}{T('zapiToken', 'Token da instância', true)}{T('zapiClientToken', 'Client-Token (segurança da conta)', true)}</div>}
      {f.provider === 'evolution' && <div className="grid">{T('evolutionUrl', 'Endereço do servidor Evolution', false, 'https://...')}{T('evolutionInstance', 'Nome da instância')}{T('evolutionKey', 'API Key', true)}</div>}
      {f.provider === 'meta' && <div className="grid">{T('metaPhoneId', 'Phone Number ID')}{T('metaToken', 'Token de acesso', true)}{T('metaTemplate', 'Nome do modelo aprovado (opcional)')}</div>}
      {f.provider === 'meta' && <p className="muted small" style={{ margin: 0 }}>No WhatsApp oficial, mensagens iniciadas pela empresa precisam de um modelo aprovado pela Meta. Crie um modelo com uma variável no corpo e informe o nome acima.</p>}
      <div className="row">
        <button className="btn primary" onClick={save}>Salvar</button>
        {cfg?.whatsapp?.configured && <button className="btn" onClick={() => run(async () => { const r = await payApi<{ sent: number }>('/api/whatsapp/test', {}); setMsg(`Enviado para ${r.sent} ${r.sent === 1 ? 'número' : 'números'}`); })}>Enviar teste agora</button>}
        <button className="btn" onClick={loadPreview}>Ver resumo de hoje</button>
      </div>
      {msg && <span className="chip">{msg}</span>}
      {preview && (
        <>
          <pre style={{ margin: 0, padding: 14, background: 'var(--field)', borderRadius: 14, whiteSpace: 'pre-wrap', font: '14px/1.5 inherit' }}>{preview}</pre>
          <a className="btn primary" style={{ alignSelf: 'flex-start' }} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(preview)}`}>Abrir no WhatsApp</a>
        </>
      )}
    </div>
  );
}

function Permissoes() {
  const [p, setP] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [saved, setSaved] = useState(false);
  useEffect(() => { getSetting<Partial<Permissions>>('permissions', {}).then((x) => setP({ ...DEFAULT_PERMISSIONS, ...x })); }, []);
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 18 }}>Quando o operador de caixa precisa da senha do gerente</h2>
      <p className="muted small" style={{ margin: 0 }}>O <b>administrador (dono)</b> e os <b>gerentes</b> têm acesso livre e nunca precisam de senha extra. Marque as ações que o operador só pode fazer com um gerente autorizando.</p>
      <div className="grid">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <label key={a} className="row" style={{ gap: 10, padding: 12, borderRadius: 14, background: p[a] ? 'var(--secondary-soft)' : 'var(--field)', cursor: 'pointer' }}>
            <input type="checkbox" checked={p[a]} onChange={(e) => { setP({ ...p, [a]: e.target.checked }); setSaved(false); }} />
            <span style={{ fontWeight: 600 }}>{ACTION_LABELS[a]}</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {saved && <span className="chip ok">Salvo</span>}
        <button className="btn primary" onClick={async () => { await setSetting('permissions', p); setSaved(true); }}>Salvar</button>
      </div>
    </div>
  );
}

function QuickItemsCfg() {
  const [list, setList] = useState<QuickItem[]>(DEFAULT_QUICK_ITEMS);
  const [saved, setSaved] = useState(false);
  useEffect(() => { getSetting('quickItems', DEFAULT_QUICK_ITEMS).then(setList); }, []);
  const upd = (i: number, patch: Partial<QuickItem>) => { setList(list.map((x, k) => (k === i ? { ...x, ...patch } : x))); setSaved(false); };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 18 }}>Valores manuais do caixa (F1)</h2>
      <p className="muted small" style={{ margin: 0 }}>Tipos que o operador escolhe ao lançar um valor à mão, como taxa de entrega. Valor sugerido é opcional.</p>
      {list.map((q, i) => (
        <div key={q.id} className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" aria-label="Nome" value={q.label} onChange={(e) => upd(i, { label: e.target.value })} />
          <input className="input" aria-label="Valor sugerido" style={{ width: 130 }} inputMode="decimal" placeholder="Valor" value={q.price !== undefined ? dec2(q.price) : ''} onChange={(e) => upd(i, { price: e.target.value ? parseNum(e.target.value) : undefined })} />
          <button className="btn sm danger" aria-label="Remover" onClick={() => { setList(list.filter((_, k) => k !== i)); setSaved(false); }}>Remover</button>
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn sm" onClick={() => setList([...list, { id: uid(), label: 'Novo tipo' }])}>+ Adicionar tipo</button>
        <div className="row">{saved && <span className="chip ok">Salvo</span>}<button className="btn primary" onClick={async () => { await setSetting('quickItems', list.filter((x) => x.label.trim())); setSaved(true); }}>Salvar</button></div>
      </div>
    </div>
  );
}

function SerialScaleCfg() {
  const [cfg, setCfg] = useState<ScaleSettings>(DEFAULT_SCALE_SETTINGS);
  const [msg, setMsg] = useState('');
  useEffect(() => { getScaleSettings().then(setCfg); }, []);
  const save = async (c: ScaleSettings) => { setCfg(c); await setScaleSettings(c); };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 18 }}>Balança no caixa (cabo serial ou USB)</h2>
      <p className="muted small" style={{ margin: 0 }}>Para balanças Toledo, Filizola, Urano, Elgin e similares ligadas no computador. Ao bipar um produto vendido por quilo (sem etiqueta), o peso é lido sozinho. Funciona no app de Windows e no Chrome/Edge do computador.</p>
      {!scaleSupported() && <span className="chip warn">Este aparelho não aceita balança no cabo.</span>}
      <div className="grid">
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ ...cfg, enabled: e.target.checked })} />Usar balança neste caixa</label>
        <div className="field"><label htmlFor="sbm">Marca</label><select id="sbm" value={cfg.brand} onChange={(e) => save({ ...cfg, brand: e.target.value as ScaleSettings['brand'] })}><option value="toledo">Toledo (Prix)</option><option value="filizola">Filizola</option><option value="urano">Urano</option><option value="outra">Outra</option></select></div>
        <div className="field"><label htmlFor="sbb">Velocidade (baud)</label><select id="sbb" value={cfg.baudRate} onChange={(e) => save({ ...cfg, baudRate: Number(e.target.value) })}>{[2400, 4800, 9600, 19200].map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
      </div>
      <div className="row">
        <button className="btn" disabled={!scaleSupported()} onClick={async () => { try { await pickScalePort(); setMsg('Porta escolhida'); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } }}>Escolher porta da balança</button>
        <button className="btn primary" disabled={!scaleSupported()} onClick={async () => { setMsg('Lendo…'); try { setMsg(`Peso lido: ${(await readWeight()).toFixed(3).replace('.', ',')} kg`); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } }}>Testar peso</button>
      </div>
      {msg && <span className="chip">{msg}</span>}
      <p className="muted small" style={{ margin: 0 }}>Balança que imprime etiqueta (açougue, padaria): a etiqueta com código começando em 2 já é lida pelo leitor. Configure abaixo, em "Balança (etiquetas)".</p>
    </div>
  );
}

function CaixaCfg() {
  const [reg, setReg] = useState('01');
  const [printMode, setPrintMode] = useState('ask');
  const [paper, setPaper] = useState(80);
  const [silent, setSilent] = useState(false);
  const [printer, setPrinter] = useState('');
  const [scale, setScale] = useState<ScaleConfig>(DEFAULT_SCALE);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      setReg(await getDevice('register', '01'));
      setPrintMode(await getDevice('printMode', 'ask'));
      setPaper(await getDevice('paperWidth', 80));
      setSilent(await getDevice('silentPrint', false));
      setPrinter(await getDevice('printerName', ''));
      setScale(await getSetting('scale', DEFAULT_SCALE));
    })();
  }, []);
  const submit = async () => {
    await setDevice('register', reg.trim() || '01');
    await setDevice('printMode', printMode);
    await setDevice('paperWidth', paper);
    await setDevice('silentPrint', silent);
    await setDevice('printerName', printer.trim());
    await setSetting('scale', scale);
    setSaved(true);
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2 style={{ fontSize: 18 }}>Este aparelho</h2>
      <div className="grid">
        <div className="field"><label htmlFor="cr">Número do caixa</label><input id="cr" value={reg} onChange={(e) => setReg(e.target.value)} /></div>
        <div className="field"><label htmlFor="cpm">Imprimir cupom</label><select id="cpm" value={printMode} onChange={(e) => setPrintMode(e.target.value)}><option value="ask">Perguntar a cada venda</option><option value="auto">Sempre imprimir</option><option value="never">Nunca imprimir</option></select></div>
        <div className="field"><label htmlFor="cpw">Largura do papel</label><select id="cpw" value={paper} onChange={(e) => setPaper(Number(e.target.value))}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></div>
      </div>
      {desktop() && (
        <div className="grid">
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} />Imprimir direto, sem abrir a janela de impressão</label>
          <div className="field"><label htmlFor="cpn">Nome da impressora (vazio = padrão do Windows)</label><input id="cpn" value={printer} onChange={(e) => setPrinter(e.target.value)} /></div>
        </div>
      )}
      <h2 style={{ fontSize: 18 }}>Balança (etiquetas que começam com 2)</h2>
      <div className="grid">
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={scale.enabled} onChange={(e) => setScale({ ...scale, enabled: e.target.checked })} />Ler etiquetas da balança</label>
        <div className="field"><label htmlFor="sl">Dígitos do código do produto</label><select id="sl" value={scale.codeLength} onChange={(e) => setScale({ ...scale, codeLength: Number(e.target.value) })}>{[4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="sm">A etiqueta traz</label><select id="sm" value={scale.mode} onChange={(e) => setScale({ ...scale, mode: e.target.value as ScaleConfig['mode'] })}><option value="price">O preço total</option><option value="weight">O peso</option></select></div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>O código do produto na balança deve ser igual ao "Código interno" do cadastro.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>{saved && <span className="chip ok">Salvo</span>}<button className="btn primary" onClick={submit}>Salvar</button></div>
    </div>
  );
}

function Nuvem() {
  const [msg, setMsg] = useState('');
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const link = STORE_SLUG ? storeLink(STORE_SLUG) : '';
  const test = async () => {
    setMsg('Testando…');
    try { await testConnection(); setMsg('Conexão OK'); } catch (e) { setMsg('Falhou: ' + (e instanceof Error ? e.message : e)); }
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="spread"><h2 style={{ fontSize: 18 }}>Nuvem</h2><SyncBadge /></div>
      <p className="muted small" style={{ margin: 0 }}>O sistema funciona sem internet. Quando há conexão, ele envia as vendas e cadastros para a nuvem e recebe o que os outros caixas fizeram. Itens aguardando envio: <b>{pending}</b></p>
      <div className="field">
        <span className="label">Link para abrir a loja em outro aparelho</span>
        <div className="row">
          <span className="chip" style={{ fontSize: 14, padding: 10, wordBreak: 'break-all' }}>{link}</span>
          <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(link); setMsg('Link copiado'); }}>Copiar</button>
        </div>
        <span className="muted small">No app de Windows ou do celular, use o código da loja: <b>{STORE_SLUG}</b></span>
      </div>
      {msg && <span className="chip">{msg}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={test}>Testar conexão</button>
        <button className="btn primary" onClick={() => syncNow()}>Sincronizar agora</button>
      </div>
    </div>
  );
}

function Backup() {
  const list = useLiveQuery(() => listBackups(), []);
  const last = useLiveQuery(() => getDevice<number>('lastBackup', 0), []);
  const [hour, setHour] = useState(8);
  const [folder, setFolder] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { getDevice('backupHour', 8).then(setHour); desktop()?.backupFolder().then(setFolder); }, []);
  const restore = async (content: string) => {
    if (!confirm('Restaurar este backup? Os dados atuais deste aparelho serão substituídos.')) return;
    await importData(content);
    setMsg('Backup restaurado');
    syncNow();
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 18 }}>Backup automático</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Um backup é feito todo dia e também ao fechar o caixa. Ficam guardados os últimos 30.
        {folder ? <> Pasta: <b>{folder}</b></> : ' Neste aparelho, os backups ficam guardados no próprio navegador/app. Use "Baixar" para guardar uma cópia fora.'}
      </p>
      <div className="row">
        <span className="chip">Último backup: {last ? dateTime(last) : 'nunca'}</span>
        <label className="row small" style={{ gap: 6 }}>Horário diário
          <select className="input" style={{ width: 100 }} value={hour} onChange={async (e) => { setHour(Number(e.target.value)); await setDevice('backupHour', Number(e.target.value)); }}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={async () => { const n = await makeBackup('manual'); setMsg('Backup feito: ' + n); }}>Fazer backup agora</button>
        <button className="btn" onClick={async () => downloadText(`vision-pdv_${Date.now()}.json`, await exportData())}>Baixar cópia</button>
        <label className="btn" style={{ cursor: 'pointer' }}>Restaurar de arquivo<input type="file" accept=".json" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) restore(await f.text()); }} /></label>
        {desktop() && <button className="btn ghost" onClick={() => desktop()!.openBackupFolder()}>Abrir pasta</button>}
      </div>
      {msg && <span className="chip ok">{msg}</span>}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Arquivo</th><th>Data</th><th className="right">Tamanho</th><th></th></tr></thead>
          <tbody>{list?.map((b) => (
            <tr key={b.name}>
              <td className="small">{b.name}</td><td>{dateTime(b.createdAt)}</td><td className="right">{(b.size / 1024).toFixed(0)} KB</td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={async () => downloadText(b.name, await readBackup(b.name))}>Baixar</button>{' '}
                <button className="btn sm danger" onClick={async () => restore(await readBackup(b.name))}>Restaurar</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <div className="empty">Nenhum backup ainda</div>}
      </div>
    </div>
  );
}
