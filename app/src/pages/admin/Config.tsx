import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDevice, setDevice, getSetting, setSetting, db } from '../../lib/db';
import { DEFAULT_THEME, PRIMARY_OPTIONS, SECONDARY_OPTIONS, applyTheme, resizeImage, type StoreInfo, type Theme } from '../../lib/theme';
import { DEFAULT_SCALE, type ScaleConfig } from '../../lib/pdv';
import { syncNow, testConnection } from '../../lib/sync';
import { STORE_SLUG, storeLink } from '../../lib/store';
import { makeBackup, listBackups, readBackup, importData, exportData, downloadText, desktop } from '../../lib/backup';
import { dateTime } from '../../lib/format';
import { useApp } from '../../lib/app-context';
import { Logo, SyncBadge } from '../../components/ui';

const TABS = { loja: 'Loja e aparência', caixa: 'Caixa, impressora e balança', nuvem: 'Nuvem (sincronização)', backup: 'Backup' } as const;

export function Config() {
  const [tab, setTab] = useState<keyof typeof TABS>('loja');
  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>
      <div className="row">{(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => <button key={k} className={'btn sm ' + (tab === k ? 'secondary' : '')} onClick={() => setTab(k)}>{TABS[k]}</button>)}</div>
      {tab === 'loja' && <Loja />}
      {tab === 'caixa' && <CaixaCfg />}
      {tab === 'nuvem' && <Nuvem />}
      {tab === 'backup' && <Backup />}
    </>
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
          <div className="field"><label htmlFor="sc">CNPJ</label><input id="sc" value={s.cnpj || ''} onChange={(e) => set('cnpj', e.target.value)} /></div>
          <div className="field"><label htmlFor="sp">Telefone</label><input id="sp" value={s.phone || ''} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="sa">Endereço</label><input id="sa" value={s.address || ''} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="sf">Mensagem no fim do cupom</label><input id="sf" value={s.receiptFooter || ''} placeholder="Obrigado pela preferência!" onChange={(e) => set('receiptFooter', e.target.value)} /></div>
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
