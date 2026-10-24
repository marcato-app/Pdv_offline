import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../lib/app-context';
import { db, round2, round3, getDevice, type CashSession, type Product, type SaleItem, type Payment, type PaymentMethod, type Customer, type Sale } from '../lib/db';
import { findProduct, readScaleLabel, makeItem, makeManualItem, searchProducts, finalizeSale, currentSession, openSession, addCashMove, sessionSummary, closeSession, customerBalance, DEFAULT_QUICK_ITEMS, type SessionSummary, type QuickItem } from '../lib/pdv';
import { useAuthorize, type Action } from '../lib/permissions';
import { getScaleSettings, readWeight } from '../lib/scale';
import { getSetting, save, uid } from '../lib/db';
import { lookupBarcode, photoToDataUrl, type CatalogItem } from '../lib/catalog';
import { money, dec2, qtyFmt, parseNum, PAYMENT_LABELS, formatCpf, isValidCpf, onlyDigits, timeOnly } from '../lib/format';
import { receiptHtml, closingHtml, cashMoveHtml, printHtml } from '../lib/receipt';
import { makeBackup } from '../lib/backup';
import { syncNow } from '../lib/sync';
import { canManage } from '../lib/auth';
import { Logo, Modal, Photo, SyncBadge } from '../components/ui';
import { ExpiredScreen, LicenseBanner } from '../components/license';
import { useLicense } from '../lib/license';
import { ExternalPay } from '../components/ExternalPay';
import { UpdateBanner } from '../components/UpdateBanner';
import { CameraButton, CameraScan } from '../components/CameraScan';
import { vibrate } from '../lib/haptics';
import { useSupportLink } from '../components/Support';
import { loadPayConfig } from '../lib/payments';
import type { PixKey } from '../lib/pix';
import { focusMainWindow, isPdvWindow, startPdvFullscreen } from '../lib/pdvWindow';

type ModalKind = null | 'qty' | 'discount' | 'search' | 'cancelItem' | 'cancelSale' | 'customer' | 'sangria' | 'suprimento' | 'pay' | 'done' | 'close' | 'menu' | 'manual' | 'unknown' | 'weight' | 'mov';

const METHODS: { key: string; method: PaymentMethod | 'split'; label: string }[] = [
  { key: '1', method: 'dinheiro', label: 'Dinheiro' },
  { key: '2', method: 'pix', label: 'PIX' },
  { key: '3', method: 'debito', label: 'Cartão de débito' },
  { key: '4', method: 'credito', label: 'Cartão de crédito' },
  { key: '5', method: 'credito_parcelado', label: 'Crédito parcelado' },
  { key: '6', method: 'vale', label: 'Vale-alimentação' },
  { key: '7', method: 'crediario', label: 'Crediário / fiado' },
  { key: '8', method: 'split', label: 'Dividir pagamento' },
];

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 320;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 250);
  } catch { /* sem som */ }
}

export function Caixa() {
  const { user, store, setUser } = useApp();
  const nav = useNavigate();
  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [selected, setSelected] = useState(-1);
  const [lastProduct, setLastProduct] = useState<Product | null>(null);
  const [code, setCode] = useState('');
  const [nextQty, setNextQty] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cpf, setCpf] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [cam, setCam] = useState(false); // leitor pela câmera (fica aberto entre um produto e outro)
  const [toast, setToast] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [clock, setClock] = useState(Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const support = useSupportLink();
  const lic = useLicense();
  const [authorize, authPrompt] = useAuthorize(user);
  const [unknownCode, setUnknownCode] = useState('');
  const [weighing, setWeighing] = useState<Product | null>(null);
  // Abre uma janela que precisa de senha do gerente (quando a ação exige).
  const ask = (action: Action, kind: ModalKind) => async () => { if (await authorize(action)) setModal(kind); };
  const addManual = (it: SaleItem) => {
    setItems((prev) => { setSelected(prev.length); return [...prev, it]; });
    setLastProduct(null);
  };

  const active = items.filter((i) => !i.canceled);
  const subtotal = round2(active.reduce((s, i) => s + i.total, 0));
  const total = round2(Math.max(0, subtotal - discount));
  const volumes = round3(active.reduce((s, i) => s + (i.unit === 'UN' ? i.qty : 1), 0));
  const register = useLiveQuery(() => getDevice<string>('register', '01'), [], '01');
  const salesToday = useLiveQuery(() => (session ? db.sales.where('sessionId').equals(session.id).filter((s) => s.status === 'completed').count() : 0), [session?.id], 0);
  const prodOf = useLiveQuery(async () => {
    const ids = [...new Set(items.map((i) => i.productId))];
    const ps = await db.products.bulkGet(ids);
    return Object.fromEntries(ps.filter(Boolean).map((p) => [p!.id, p!]));
  }, [items.length], {} as Record<string, Product>);

  useEffect(() => { currentSession().then(setSession); }, []);
  useEffect(() => startPdvFullscreen(), []);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const hasItems = items.some((i) => !i.canceled);
  // O campo do código muda de lugar quando a venda começa (tela "Próximo cliente" → tela da venda): devolve o foco.
  useEffect(() => { if (!modal) setTimeout(() => codeRef.current?.focus(), 0); }, [modal, session, hasItems]);
  const [payInit, setPayInit] = useState<PaymentMethod | undefined>(undefined);
  const itemsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); } }, [toast]);

  const resetSale = () => {
    setItems([]); setSelected(-1); setLastProduct(null); setDiscount(0); setCustomer(null); setCpf(''); setNextQty(1); setCode('');
  };

  const addProduct = useCallback((p: Product, qty: number, forcedTotal?: number) => {
    vibrate('ok');
    setItems((prev) => {
      const idx = forcedTotal === undefined && p.unit === 'UN' ? prev.findIndex((i) => i.productId === p.id && !i.canceled) : -1;
      if (idx >= 0) {
        const merged = makeItem(p, round3(prev[idx].qty + qty));
        const copy = [...prev];
        copy.splice(idx, 1);
        copy.push(merged);
        setSelected(copy.length - 1);
        return copy;
      }
      setSelected(prev.length);
      return [...prev, makeItem(p, qty, forcedTotal)];
    });
    setLastProduct(p);
  }, []);

  // Leituras do leitor de código entram numa fila, para não perder códigos bipados em sequência rápida.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const qtyRef = useRef(nextQty);
  qtyRef.current = nextQty;
  const onCode = (given?: string) => {
    const raw = (given ?? code).trim();
    if (given === undefined) setCode('');
    if (!raw) return;
    queue.current = queue.current.then(async () => {
      let c = raw;
      let qty = qtyRef.current;
      const m = c.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
      if (m) { qty = parseNum(m[1]); c = m[2]; }
      const found = await findProduct(c);
      if (!found) {
        // Etiqueta da balança com o valor no código, mas sem produto com esse código interno:
        // vende pelo valor impresso, sem travar o caixa.
        const label = await readScaleLabel(c);
        if (label && label.mode === 'price' && label.value > 0) {
          addManual(makeManualItem('avulso', `ITEM DA BALANÇA · CÓD ${label.code}`, label.value / 100, 1, c));
          setToast(`Etiqueta da balança: ${money(label.value / 100)}. Cadastre o código ${label.code} em Produtos (código interno) para aparecer o nome.`);
          return;
        }
        beep(); vibrate('erro'); setUnknownCode(c); setModal('unknown'); return;
      }
      if (found.qty !== undefined) addProduct(found.product, found.qty, found.total);
      else if (found.product.unit === 'KG' && !m) {
        // Produto por quilo sem etiqueta: pesa na balança do caixa, ou digita o peso.
        const sc = await getScaleSettings();
        if (sc.enabled) {
          try { addProduct(found.product, await readWeight()); }
          catch (e) { setToast(e instanceof Error ? e.message : String(e)); setWeighing(found.product); setModal('weight'); }
        } else { setWeighing(found.product); setModal('weight'); }
      }
      else addProduct(found.product, qty);
      qtyRef.current = 1;
      setNextQty(1);
    });
  };

  // Atalhos de teclado
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal || !session || authPrompt) return;
      const pay = (m?: PaymentMethod) => { if (active.length) { setPayInit(m); setModal('pay'); } };
      const map: Record<string, () => void> = {
        F1: () => (e.ctrlKey ? ask('valorManual', 'manual')() : setModal('search')),
        F2: () => setModal('qty'),
        F3: () => active.length && ask('cancelarItem', 'cancelItem')(),
        F4: () => active.length && ask('desconto', 'discount')(),
        F5: () => pay(e.ctrlKey ? 'pix' : 'dinheiro'),
        F6: () => (e.ctrlKey ? active.length && ask('cancelarVenda', 'cancelSale')() : setModal('customer')),
        F7: () => pay('credito'),
        F8: () => pay('debito'),
        F9: () => focusItems(),
        F10: () => setModal('mov'),
        F11: () => pay('crediario'),
        F12: () => setModal('menu'),
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [modal, session, active.length, authPrompt, items, selected]);

  // F9: anda pelos itens da compra com as setas (Enter ou Esc volta para o código).
  function focusItems() {
    if (!items.length) return;
    if (selected < 0) setSelected(items.length - 1);
    itemsRef.current?.focus();
  }
  const onItemsKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.min(items.length - 1, Math.max(0, selected + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelected(n);
      itemsRef.current?.querySelectorAll('tbody tr')[n]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); codeRef.current?.focus(); }
    else if (e.key === 'Delete') { e.preventDefault(); ask('cancelarItem', 'cancelItem')(); }
  };
  const onCodeEnter = () => {
    // Campo vazio + Enter: vai para o pagamento (todas as formas).
    if (!code.trim()) { if (active.length) { setPayInit(undefined); setModal('pay'); } return; }
    onCode();
  };

  if (!user) return null;
  if (session === undefined) return null;
  if (lic && (lic.status === 'expired' || lic.status === 'blocked')) return <ExpiredScreen />;

  if (!session) {
    return <>
      <OpenCash onOpen={async (amount) => {
        if (!(await authorize('abrirCaixa'))) return;
        const s = await openSession(user, amount);
        setSession(s);
      }} onBack={() => (canManage(user) ? nav('/painel') : (setUser(null), nav('/login')))} />
      {authPrompt}
    </>;
  }

  const current = selected >= 0 ? items[selected] : null;
  const payBtn = (m?: PaymentMethod) => () => { if (active.length) { setPayInit(m); setModal('pay'); } };
  const shortcuts: [string, string, () => void][] = [
    ['F1', 'Pesquisa produto', () => setModal('search')],
    ['F2', 'Quantidade', () => setModal('qty')],
    ['F3', 'Cancelar item', () => { if (active.length) ask('cancelarItem', 'cancelItem')(); }],
    ['F4', 'Desconto', () => { if (active.length) ask('desconto', 'discount')(); }],
    ['F5', 'Dinheiro', payBtn('dinheiro')],
    ['F6', 'Cliente', () => setModal('customer')],
    ['F7', 'Cartão crédito', payBtn('credito')],
    ['F8', 'Cartão débito', payBtn('debito')],
    ['F9', 'Itens da compra', () => focusItems()],
    ['F10', 'Movimento caixa', () => setModal('mov')],
    ['F11', 'Crediário', payBtn('crediario')],
    ['F12', 'Configurações', () => setModal('menu')],
    ['Ctrl+F1', 'Valor manual', ask('valorManual', 'manual')],
    ['Ctrl+F5', 'PIX', payBtn('pix')],
  ];

  return (
    <div className="pdv">
      <header className="pdv-head">
        <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}><Logo /><span style={{ fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{store.name}</span></div>
        <div className="info">
          <span>Caixa {register}</span>
          <span className="hide-m">{user.name}</span>
          <span className="hide-m">{new Date(clock).toLocaleDateString('pt-BR')} · {timeOnly(clock)}</span>
          <SyncBadge />
        </div>
      </header>

      <div className="pdv-body">
        {!active.length ? (
          <section className="pdv-left">
            <UpdateBanner />
            <LicenseBanner />
            <div className="idle">
              <div className="photo" style={{ width: 170, height: 170, borderRadius: 40 }}>
                {store.logo ? <img src={store.logo} alt={store.name} /> : store.name}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="chip ok" style={{ alignSelf: 'center', letterSpacing: '0.08em' }}>CAIXA LIVRE</span>
                <h1>Próximo cliente</h1>
                <p className="muted" style={{ margin: 0, fontSize: 18 }}>Bipe o primeiro produto para começar a venda</p>
              </div>
              <CodeInput refEl={codeRef} code={code} setCode={setCode} onEnter={onCodeEnter} onCamera={() => setCam(true)} nextQty={nextQty} />
            </div>
          </section>
        ) : (
          <section className="pdv-left">
            <div className="current">
              <Photo src={current ? prodOf[current.productId]?.photo : undefined} size={190} product={current ? prodOf[current.productId] || { description: current.description } : null} />
              <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                {lastProduct && current?.productId === lastProduct.id && (
                  <div className="row chips" style={{ gap: 6 }}>
                    {(lastProduct.subcategory || lastProduct.category) && <span className="chip">{lastProduct.subcategory || lastProduct.category}{lastProduct.family ? ' › ' + lastProduct.family : ''}</span>}
                    {lastProduct.basket && <span className="chip ok">{lastProduct.basket}</span>}
                  </div>
                )}
                <h2>{current?.description}</h2>
                <span className="muted">{[lastProduct?.id === current?.productId && lastProduct?.brand, current?.barcode].filter(Boolean).join(' · ')}</span>
                {current && (
                  <div className="row" style={{ gap: '4px 26px', alignItems: 'baseline' }}>
                    <span className="unit-line" style={{ fontSize: 20, fontWeight: 600 }}>{qtyFmt(current.qty)} {current.unit} × {money(current.unitPrice)}</span>
                    <span className="big-price" style={{ fontSize: 40, fontWeight: 800, color: 'var(--primary)' }}>{money(current.total)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="row">
              <div style={{ flex: '1 1 300px' }}><CodeInput refEl={codeRef} code={code} setCode={setCode} onEnter={onCodeEnter} onCamera={() => setCam(true)} nextQty={nextQty} /></div>
            </div>
            <div className="table-wrap items-list" ref={itemsRef} tabIndex={-1} onKeyDown={onItemsKey}>
              <table className="t" style={{ minWidth: 520 }}>
                <thead><tr><th>#</th><th>Produto</th><th>Qtd</th><th>Unit.</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className={(i === selected ? 'sel ' : '') + (it.canceled ? 'cut' : '') + ' click'} onClick={() => setSelected(i)}>
                      <td>{i + 1}</td>
                      <td>{it.description}</td>
                      <td>{qtyFmt(it.qty)} {it.unit}<span className="only-m"> × {dec2(it.unitPrice)}</span></td>
                      <td>{dec2(it.unitPrice)}</td>
                      <td className="right">{dec2(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <aside className="pdv-right">
          <div className="pdv-paybar">
          <div className="total-box">
            <div className="spread sub" style={{ fontSize: 15, color: '#e4dcfa' }}><span>{active.length} {active.length === 1 ? 'item' : 'itens'} · {qtyFmt(volumes)} {volumes === 1 ? 'volume' : 'volumes'}</span><span>{money(subtotal)}</span></div>
            <div className="spread sub" style={{ fontSize: 15, color: '#e4dcfa' }}><span>Desconto (F4)</span><span>{money(discount)}</span></div>
            <div className="lbl" style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>TOTAL A PAGAR</div>
            <div className="big">{money(total)}</div>
          </div>
          <button className="btn primary big pay-btn" style={{ height: 64 }} disabled={!active.length} onClick={payBtn()}>Pagamento (Enter)</button>
          </div>
          <div className="card pdv-extra" style={{ padding: 16, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
            <span className="muted">Cliente (F6)</span>
            <b>{customer ? customer.name : 'Consumidor final'}</b>
            {cpf && <span>CPF {formatCpf(cpf)}</span>}
          </div>
          {!active.length && (
            <div className="card pdv-extra" style={{ padding: 16, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <div className="spread"><span className="muted">Fundo de troco</span><b>{money(session.openingAmount)}</b></div>
              <div className="spread"><span className="muted">Vendas neste turno</span><b>{salesToday}</b></div>
              {lastSale && <div className="spread"><span className="muted">Última venda</span><b>{lastSale.number} · {money(lastSale.total)}</b></div>}
              {lastSale && <button className="btn sm ghost" onClick={async () => { if (await authorize('reimprimir')) printHtml(await receiptHtml(lastSale)); }}>Reimprimir último cupom</button>}
            </div>
          )}
          {!!active.length && <button className="btn ghost pdv-extra" onClick={ask('cancelarVenda', 'cancelSale')}>Cancelar venda (Ctrl+F6)</button>}
        </aside>
      </div>

      <footer className="pdv-foot">
        {shortcuts.map(([k, l, fn]) => <button key={k} className={'k-' + k.replace('+', '-')} onClick={fn}><span className="kbd">{k}</span>{l}</button>)}
      </footer>

      {toast && <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', background: 'var(--danger)', color: '#fff', padding: '14px 22px', borderRadius: 14, fontWeight: 700, zIndex: 60 }}>{toast}</div>}

      {authPrompt}
      {/* Câmera antes das janelas: se bipar um produto sem cadastro, a janela aparece por cima. */}
      {cam && <CameraScan continuous onCode={(c) => onCode(c)} onClose={() => setCam(false)} />}
      {modal === 'manual' && <ManualModal onClose={() => setModal(null)} onAdd={(it) => { addManual(it); setModal(null); }} />}
      {modal === 'unknown' && <UnknownModal code={unknownCode} onClose={() => setModal(null)} onAdd={async (desc, price, qty) => {
        if (!(await authorize('valorManual'))) return;
        addManual(makeManualItem('naocadastrado', desc, price, qty, unknownCode));
        setModal(null);
      }} onCreate={async (it, price, qty, photo) => {
        if (!(await authorize('valorManual'))) return;
        // Cadastro relâmpago com os dados do banco de produtos.
        const prod = await save<Product>('products', {
          id: uid(), barcode: unknownCode, description: it.description || 'PRODUTO', brand: it.brand || undefined, manufacturer: it.manufacturer || undefined,
          segment: it.segment || undefined, department: it.department || undefined, category: it.category || undefined, subcategory: it.subcategory || undefined, family: it.family || undefined, basket: it.basket || undefined, content: it.content || undefined,
          ncm: it.ncm || undefined, photo, unit: 'UN', cost: 0, price, minStock: 0, active: 1,
        });
        addProduct(prod, qty);
        setModal(null);
      }} />}
      {modal === 'weight' && weighing && <NumberModal title={`Peso · ${weighing.description}`} label="Peso em kg (ex.: 0,850)" initial="" onClose={() => setModal(null)} onOk={(v) => { if (v > 0) addProduct(weighing, round3(v)); setModal(null); }} />}
      {modal === 'qty' && <NumberModal title="Quantidade do próximo item" label="Quantidade" initial={String(nextQty)} onClose={() => setModal(null)} onOk={(v) => { if (v > 0) setNextQty(v); setModal(null); }} />}
      {modal === 'discount' && <DiscountModal subtotal={subtotal} current={discount} onClose={() => setModal(null)} onOk={(v) => { setDiscount(v); setModal(null); }} />}
      {modal === 'search' && <SearchModal onClose={() => setModal(null)} onPick={(p) => { addProduct(p, nextQty); setNextQty(1); setModal(null); }} />}
      {modal === 'cancelItem' && <NumberModal title="Cancelar item" label="Número do item" initial={String(selected + 1)} onClose={() => setModal(null)} onOk={(v) => {
        const i = Math.round(v) - 1;
        if (items[i] && !items[i].canceled) setItems(items.map((it, k) => (k === i ? { ...it, canceled: true } : it)));
        setModal(null);
      }} />}
      {modal === 'cancelSale' && (
        <Modal title="Cancelar venda" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Voltar (Esc)</button>
          <button className="btn danger" autoFocus onClick={() => { resetSale(); setModal(null); }}>Cancelar a venda</button>
        </>}>
          <p style={{ margin: 0 }}>Todos os {active.length} itens serão removidos. Confirma?</p>
        </Modal>
      )}
      {modal === 'customer' && <CustomerModal cpf={cpf} customer={customer} onClose={() => setModal(null)} onOk={(c, d) => { setCustomer(c); setCpf(d); setModal(null); }} />}
      {(modal === 'sangria' || modal === 'suprimento') && <CashMoveModal type={modal} onClose={() => setModal(null)} onOk={async (amount, reason) => {
        await addCashMove(session, modal, amount, reason);
        printHtml(await cashMoveHtml(modal, amount, reason, user.name));
        setModal(null);
      }} />}
      {modal === 'pay' && <PayModal total={total} customer={customer} initial={payInit} onClose={() => setModal(null)} onPaid={async (payments) => {
        try {
          const sale = await finalizeSale({ session, operator: user, items, discount, payments, customerId: customer?.id, cpf: cpf || undefined });
          setLastSale(sale);
          resetSale();
          syncNow();
          const mode = await getDevice<string>('printMode', 'ask');
          if (mode === 'auto') printHtml(await receiptHtml(sale));
          setModal(mode === 'ask' ? 'done' : null);
        } catch (e) {
          setToast(e instanceof Error ? e.message : String(e));
        }
      }} />}
      {modal === 'done' && lastSale && (
        <Modal title="Venda concluída" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Não imprimir (Esc)</button>
          <button className="btn primary" autoFocus onClick={async () => { await printHtml(await receiptHtml(lastSale)); setModal(null); }}>Imprimir cupom (Enter)</button>
        </>}>
          <div className="spread"><span>Total</span><b style={{ fontSize: 22 }}>{money(lastSale.total)}</b></div>
          {lastSale.change > 0 && <div className="spread" style={{ background: 'var(--ok-bg)', color: 'var(--ok)', padding: 16, borderRadius: 14 }}><b>Troco</b><b style={{ fontSize: 32 }}>{money(lastSale.change)}</b></div>}
        </Modal>
      )}
      {modal === 'close' && <CloseModal session={session} onClose={() => setModal(null)} onClosed={async (counted, notes) => {
        const { closed, sum } = await closeSession(session, counted, notes);
        await makeBackup('fechamento').catch(() => undefined);
        syncNow();
        printHtml(await closingHtml(closed, sum));
        setSession(null);
        setModal(null);
      }} />}
      {modal === 'mov' && <MovModal canClose={!active.length} onClose={() => setModal(null)} onPick={(k) => {
        setModal(null);
        if (k === 'sangria') ask('sangria', 'sangria')();
        if (k === 'suprimento') ask('suprimento', 'suprimento')();
        if (k === 'close') ask('fecharCaixa', 'close')();
      }} />}
      {modal === 'menu' && (
        <Modal title="Menu" onClose={() => setModal(null)}>
          {canManage(user) && <button className="btn big" onClick={() => { setModal(null); if (!focusMainWindow()) nav('/painel'); }}>Ir para a gestão</button>}
          {isPdvWindow() && <button className="btn big" onClick={() => window.close()}>Fechar esta janela</button>}
          <button className="btn big" onClick={() => { setModal(null); syncNow(); }}>Sincronizar agora</button>
          {support && <a className="btn big" href={support} target="_blank" rel="noreferrer">Falar com o suporte (WhatsApp)</a>}
          <button className="btn big" onClick={async () => { await makeBackup('manual'); setModal(null); setToast('Backup feito'); }}>Fazer backup agora</button>
          <button className="btn big danger" disabled={!!active.length} onClick={() => { setUser(null); nav('/login'); }}>Trocar operador (sair)</button>
        </Modal>
      )}
    </div>
  );
}

function ManualModal({ onClose, onAdd }: { onClose: () => void; onAdd: (it: SaleItem) => void }) {
  const types = useLiveQuery(() => getSetting<QuickItem[]>('quickItems', DEFAULT_QUICK_ITEMS), [], DEFAULT_QUICK_ITEMS);
  const [type, setType] = useState<QuickItem | null>(null);
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const pick = (t: QuickItem) => { setType(t); setDesc(t.label); setPrice(t.price ? dec2(t.price) : ''); setTimeout(() => document.getElementById('mvp')?.focus(), 0); };
  const ok = () => { const v = parseNum(price); if (v > 0 && desc.trim()) onAdd(makeManualItem('avulso', desc.trim(), v, Math.max(1, parseNum(qty) || 1))); };
  return (
    <Modal title="Lançar valor manual" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Voltar (Esc)</button><button className="btn primary" onClick={ok}>Adicionar (Enter)</button></>}>
      <div className="row">{types.map((t, i) => <button key={t.id} className={'btn sm ' + (type?.id === t.id ? 'secondary' : '')} onClick={() => pick(t)}>{i + 1}. {t.label}</button>)}</div>
      <div className="field"><label htmlFor="mvd">Descrição</label><input id="mvd" autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => {
        const n = Number(e.key); if (!desc && n >= 1 && n <= types.length) { e.preventDefault(); pick(types[n - 1]); }
        if (e.key === 'Enter') document.getElementById('mvp')?.focus();
      }} /></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="field" style={{ flex: 2 }}><label htmlFor="mvp">Valor</label><input id="mvp" className="input big" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="mvq">Qtd</label><input id="mvq" className="input big" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></div>
      </div>
    </Modal>
  );
}

function UnknownModal({ code, onClose, onAdd, onCreate }: { code: string; onClose: () => void; onAdd: (desc: string, price: number, qty: number) => void; onCreate: (it: CatalogItem, price: number, qty: number, photo?: string) => void }) {
  const [desc, setDesc] = useState('PRODUTO NÃO CADASTRADO');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [found, setFound] = useState<CatalogItem | null | undefined>(undefined);
  useEffect(() => {
    beep();
    lookupBarcode(code).then((it) => { setFound(it); if (it?.description) setDesc(it.description.toUpperCase()); });
  }, []);
  const v = () => parseNum(price);
  const q = () => Math.max(0.001, parseNum(qty) || 1);
  const ok = () => { if (v() > 0) onAdd(desc.trim() || 'PRODUTO NÃO CADASTRADO', v(), q()); };
  const create = async () => {
    if (!found || v() <= 0) return;
    const photo = found.photo ? await photoToDataUrl(found.photo) : undefined;
    onCreate({ ...found, description: desc.trim() || found.description }, v(), q(), photo);
  };
  return (
    <Modal title="Produto não cadastrado" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Não vender (Esc)</button>
      <button className={'btn ' + (found ? '' : 'primary')} onClick={ok}>Vender sem cadastrar{found ? '' : ' (Enter)'}</button>
      {found && <button className="btn primary" onClick={create}>Cadastrar e vender (Enter)</button>}
    </>}>
      {found === undefined && <span className="muted small">Procurando no banco de produtos…</span>}
      {found ? (
        <div className="row" style={{ alignItems: 'center', gap: 14, background: 'var(--ok-bg)', padding: 12, borderRadius: 14 }}>
          {found.photo && <img src={found.photo} alt="" style={{ width: 64, height: 64, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />}
          <span style={{ color: 'var(--ok)' }}><b>Encontrado no banco de produtos.</b><br />Informe o preço para cadastrar e vender agora.</span>
        </div>
      ) : (
        <p style={{ margin: 0 }}>O código <b>{code}</b> não tem cadastro. Você pode vender informando o preço. Ele vai aparecer em <b>Produtos</b> para cadastrar depois, e esta venda passa a contar para ele.</p>
      )}
      <div className="field"><label htmlFor="ucd">Descrição</label><input id="ucd" value={desc} onFocus={(e) => e.target.select()} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="field" style={{ flex: 2 }}><label htmlFor="ucp">Preço</label><input id="ucp" className="input big" autoFocus inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (found ? create() : ok())} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="ucq">Qtd</label><input id="ucq" className="input big" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (found ? create() : ok())} /></div>
      </div>
    </Modal>
  );
}

function CodeInput({ refEl, code, setCode, onEnter, onCamera, nextQty }: { refEl: React.RefObject<HTMLInputElement>; code: string; setCode: (s: string) => void; onEnter: () => void; onCamera: () => void; nextQty: number }) {
  return (
    <div className="field" style={{ width: '100%', maxWidth: 560, textAlign: 'left' }}>
      <label htmlFor="code">Código de barras{nextQty !== 1 ? ` · próximo item: ${qtyFmt(nextQty)} un` : ''}</label>
      <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
        <input id="code" ref={refEl} className="input big" style={{ flex: 1, minWidth: 0 }} autoComplete="off" inputMode="numeric" placeholder="Bipe ou digite o código e tecle Enter"
          value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
        <CameraButton className="btn big" onOpen={onCamera} />
      </div>
    </div>
  );
}

function OpenCash({ onOpen, onBack }: { onOpen: (amount: number) => void; onBack: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <form className="modal" onSubmit={(e) => { e.preventDefault(); onOpen(parseNum(v)); }}>
        <div className="modal-head"><h2 style={{ fontSize: 20, fontWeight: 800 }}>Abrir caixa</h2></div>
        <div className="modal-body">
          <div className="field"><label htmlFor="ft">Fundo de troco (dinheiro na gaveta)</label><input id="ft" className="input big" autoFocus inputMode="decimal" placeholder="0,00" value={v} onChange={(e) => setV(e.target.value)} /></div>
        </div>
        <div className="modal-foot"><button type="button" className="btn" onClick={onBack}>Voltar</button><button className="btn primary">Abrir caixa</button></div>
      </form>
    </div>
  );
}

function NumberModal({ title, label, initial, onClose, onOk }: { title: string; label: string; initial: string; onClose: () => void; onOk: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Voltar (Esc)</button><button className="btn primary" onClick={() => onOk(parseNum(v))}>Confirmar (Enter)</button></>}>
      <div className="field"><label htmlFor="nm">{label}</label>
        <input id="nm" className="input big" autoFocus inputMode="decimal" value={v} onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(parseNum(v))} />
      </div>
    </Modal>
  );
}

function DiscountModal({ subtotal, current, onClose, onOk }: { subtotal: number; current: number; onClose: () => void; onOk: (v: number) => void }) {
  const [v, setV] = useState(current ? dec2(current) : '');
  const [pct, setPct] = useState(false);
  const value = round2(Math.min(subtotal, pct ? (subtotal * parseNum(v)) / 100 : parseNum(v)));
  return (
    <Modal title="Desconto na venda" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Voltar (Esc)</button><button className="btn primary" onClick={() => onOk(value)}>Aplicar (Enter)</button></>}>
      <div className="row">
        <button className={'btn sm ' + (!pct ? 'secondary' : '')} onClick={() => setPct(false)}>Em reais</button>
        <button className={'btn sm ' + (pct ? 'secondary' : '')} onClick={() => setPct(true)}>Em %</button>
      </div>
      <div className="field"><label htmlFor="dc">{pct ? 'Percentual' : 'Valor'}</label>
        <input id="dc" className="input big" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(value)} />
      </div>
      <div className="spread"><span className="muted">Novo total</span><b style={{ fontSize: 22 }}>{money(subtotal - value)}</b></div>
    </Modal>
  );
}

function SearchModal({ onClose, onPick }: { onClose: () => void; onPick: (p: Product) => void }) {
  const [t, setT] = useState('');
  const [sel, setSel] = useState(0);
  const results = useLiveQuery(() => searchProducts(t), [t], [] as Product[]);
  return (
    <Modal title="Buscar produto" wide onClose={onClose}>
      <input className="input big" autoFocus placeholder="Nome, marca ou código" value={t} onChange={(e) => { setT(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter' && results[sel]) onPick(results[sel]);
        }} />
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="t">
          <thead><tr><th>Produto</th><th>Marca</th><th>Código</th><th className="right">Preço</th></tr></thead>
          <tbody>
            {results.map((p, i) => (
              <tr key={p.id} className={'click ' + (i === sel ? 'sel' : '')} onClick={() => onPick(p)}>
                <td>{p.description}</td><td>{p.brand}</td><td>{p.barcode}</td><td className="right">{money(p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {t && !results.length && <div className="empty">Nenhum produto encontrado</div>}
      </div>
    </Modal>
  );
}

function CustomerModal({ cpf, customer, onClose, onOk }: { cpf: string; customer: Customer | null; onClose: () => void; onOk: (c: Customer | null, cpf: string) => void }) {
  const [doc, setDoc] = useState(cpf ? formatCpf(cpf) : '');
  const [t, setT] = useState('');
  const [picked, setPicked] = useState<Customer | null>(customer);
  const list = useLiveQuery(() => {
    const q = t.trim().toLowerCase();
    if (!q) return [] as Customer[];
    return db.customers.filter((c) => !c.deleted && (c.name.toLowerCase().includes(q) || onlyDigits(c.cpf || '').includes(onlyDigits(q) || '#') || (c.phone || '').includes(q))).limit(8).toArray();
  }, [t], [] as Customer[]);
  const d = onlyDigits(doc);
  const bad = d.length > 0 && !isValidCpf(d);
  return (
    <Modal title="Cliente da venda" onClose={onClose} footer={<>
      <button className="btn" onClick={() => onOk(null, '')}>Consumidor final</button>
      <button className="btn primary" disabled={bad} onClick={() => onOk(picked, d || onlyDigits(picked?.cpf || ''))}>Confirmar</button>
    </>}>
      <div className="field"><label htmlFor="cpfn">CPF na nota</label><input id="cpfn" className="input" autoFocus inputMode="numeric" value={doc} onChange={(e) => setDoc(formatCpf(e.target.value))} /></div>
      {bad && <span className="error small">CPF inválido</span>}
      <div className="field"><label htmlFor="cbs">Cliente cadastrado (para crediário)</label><input id="cbs" className="input" placeholder="Nome, CPF ou telefone" value={t} onChange={(e) => setT(e.target.value)} /></div>
      {picked && <span className="chip ok">Selecionado: {picked.name}</span>}
      {list.map((c) => <button key={c.id} className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setPicked(c); setT(''); if (c.cpf && !d) setDoc(formatCpf(c.cpf)); }}>{c.name} {c.cpf ? '· ' + formatCpf(c.cpf) : ''}</button>)}
    </Modal>
  );
}

function CashMoveModal({ type, onClose, onOk }: { type: 'sangria' | 'suprimento'; onClose: () => void; onOk: (amount: number, reason?: string) => void }) {
  const [v, setV] = useState('');
  const [r, setR] = useState('');
  const ok = () => parseNum(v) > 0 && onOk(parseNum(v), r || undefined);
  return (
    <Modal title={type === 'sangria' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar dinheiro)'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar (Esc)</button><button className="btn primary" onClick={ok}>Confirmar e imprimir</button></>}>
      <div className="field"><label htmlFor="cmv">Valor</label><input id="cmv" className="input big" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></div>
      <div className="field"><label htmlFor="cmr">Motivo (opcional)</label><input id="cmr" value={r} onChange={(e) => setR(e.target.value)} /></div>
    </Modal>
  );
}

function PayModal({ total, customer, initial, onClose, onPaid }: { total: number; customer: Customer | null; initial?: PaymentMethod; onClose: () => void; onPaid: (p: Payment[]) => void }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');
  const [step, setStep] = useState<'method' | 'amount'>('method');
  const [amount, setAmount] = useState('');
  const [inst, setInst] = useState('2');
  const [err, setErr] = useState('');
  const [external, setExternal] = useState<{ kind: 'pix-mp' | 'pix-static' | 'point'; p: Payment } | null>(null);
  const refId = useRef(crypto.randomUUID());
  // Configuração de PIX/maquininha: carrega ao abrir; a confirmação espera ela terminar.
  const cfgPromise = useRef<Promise<{ pay: Awaited<ReturnType<typeof loadPayConfig>>; pixKey: PixKey | null }> | null>(null);
  if (!cfgPromise.current) cfgPromise.current = (async () => ({ pay: await loadPayConfig(), pixKey: await getSetting<PixKey | null>('pixKey', null) }))();
  const [cfg, setCfg] = useState<{ pay: Awaited<ReturnType<typeof loadPayConfig>>; pixKey: PixKey | null } | undefined>(undefined);
  useEffect(() => { cfgPromise.current!.then(setCfg); }, []);
  const amountRef = useRef<HTMLInputElement>(null);
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = round2(Math.max(0, total - paid));
  const typed = parseNum(amount);
  const change = method === 'dinheiro' ? round2(Math.max(0, typed - remaining)) : 0;

  const choose = (m: PaymentMethod | 'split') => {
    setErr('');
    if (m !== 'split') setMethod(m);
    setAmount(dec2(remaining));
    setStep('amount');
    setTimeout(() => { amountRef.current?.focus(); amountRef.current?.select(); }, 0);
  };

  // Aberto por F5/F7/F8/F11: já entra na forma escolhida.
  useEffect(() => { if (initial) choose(initial); }, []);

  const confirm = async () => {
    setErr('');
    let value = typed;
    if (value <= 0) return setErr('Informe o valor');
    if (method !== 'dinheiro' && value > remaining + 0.001) return setErr('Este valor é maior que o que falta pagar');
    if (method === 'crediario') {
      if (!customer) return setErr('Identifique o cliente antes (F6)');
      const owed = await customerBalance(customer.id);
      if (customer.creditLimit > 0 && owed + value > customer.creditLimit + 0.001) return setErr(`Limite insuficiente. Disponível: ${money(customer.creditLimit - owed)}`);
    }
    value = round2(value);
    const p: Payment = { method, amount: value, ...(method === 'credito_parcelado' ? { installments: Math.max(2, Math.round(parseNum(inst))) } : {}) };
    // PIX e cartão: cobra direto (QR na tela ou valor na maquininha) quando está configurado.
    const online = navigator.onLine;
    const cfg = await cfgPromise.current!;
    if (method === 'pix' && online && cfg?.pay?.mercadoPago) return setExternal({ kind: 'pix-mp', p });
    if (method === 'pix' && cfg?.pixKey?.key) return setExternal({ kind: 'pix-static', p });
    if (['debito', 'credito', 'credito_parcelado'].includes(method) && online && cfg?.pay?.mpPointDeviceId) return setExternal({ kind: 'point', p });
    addPayment(p);
  };

  const addPayment = (p: Payment) => {
    setExternal(null);
    const next = [...payments, p];
    if (round2(next.reduce((s, x) => s + x.amount, 0)) + 0.001 >= total) return onPaid(next);
    setPayments(next);
    setStep('method');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (step !== 'method' || external || e.defaultPrevented) return; // defaultPrevented: o Enter que abriu esta janela
      const m = METHODS.find((x) => x.key === e.key);
      if (m) { e.preventDefault(); choose(m.method); }
      if (e.key === 'Enter') { e.preventDefault(); choose(method); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (external) {
    const cardType = external.p.method === 'debito' ? 'debit_card' : 'credit_card';
    return (
      <Modal title={external.kind === 'point' ? 'Pagamento na maquininha' : 'Pagamento com PIX'} onClose={() => setExternal(null)}>
        <ExternalPay kind={external.kind} amount={external.p.amount} refId={refId.current + '-' + payments.length} pixKey={cfg?.pixKey}
          cardType={cardType} installments={external.p.installments}
          onApproved={(ref) => addPayment({ ...external.p, ref, provider: external.kind === 'pix-static' ? 'pix-chave' : 'mercadopago' })}
          onCancel={() => setExternal(null)} />
      </Modal>
    );
  }

  return (
    <Modal title="Forma de pagamento" wide onClose={() => (step === 'amount' ? setStep('method') : onClose())}
      right={<div className="row" style={{ alignItems: 'baseline' }}><span style={{ color: '#e4dcfa', fontSize: 14 }}>Falta pagar</span><span style={{ fontSize: 32, fontWeight: 800 }}>{money(remaining)}</span></div>}
      footer={<>
        <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>{step === 'method' ? 'Tecle o número da forma de pagamento' : 'Enter confirma · Esc volta'}</span>
        <button className="btn" onClick={() => (step === 'amount' ? setStep('method') : onClose())}>Voltar (Esc)</button>
        {step === 'amount' && <button className="btn primary" onClick={confirm}>Confirmar (Enter)</button>}
      </>}>
      <div className="row" style={{ alignItems: 'stretch', gap: 20 }}>
        <div className="pay-grid" style={{ flex: '1 1 360px', alignContent: 'start' }}>
          {METHODS.map((m) => (
            <button key={m.key} type="button" className={'pay-opt' + (m.method === method && step === 'amount' ? ' on' : '')} onClick={() => choose(m.method)}><b>{m.key}</b>{m.label}</button>
          ))}
        </div>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {payments.length > 0 && (
            <div className="stat">
              {payments.map((p, i) => <div key={i} className="spread small"><span>{PAYMENT_LABELS[p.method]}{p.installments ? ` ${p.installments}x` : ''}</span><b>{money(p.amount)}</b></div>)}
              <button className="btn sm ghost" onClick={() => setPayments(payments.slice(0, -1))}>Remover último</button>
            </div>
          )}
          {step === 'amount' && (
            <>
              <div className="field"><label htmlFor="pv">Valor em {PAYMENT_LABELS[method]}</label>
                <input id="pv" ref={amountRef} className="input big" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }} />
              </div>
              {method === 'credito_parcelado' && <div className="field"><label htmlFor="pi">Parcelas</label><input id="pi" className="input" inputMode="numeric" value={inst} onChange={(e) => setInst(e.target.value)} /></div>}
              {method === 'dinheiro' && (
                <div className="spread" style={{ background: 'var(--ok-bg)', color: 'var(--ok)', borderRadius: 14, padding: 16 }}><b>Troco</b><b style={{ fontSize: 30 }}>{money(change)}</b></div>
              )}
              {method === 'crediario' && <span className="small">{customer ? `Cliente: ${customer.name}` : 'Nenhum cliente identificado'}</span>}
            </>
          )}
          {err && <div className="error">{err}</div>}
        </div>
      </div>
    </Modal>
  );
}

function CloseModal({ session, onClose, onClosed }: { session: CashSession; onClose: () => void; onClosed: (counted: number, notes?: string) => void }) {
  const [sum, setSum] = useState<SessionSummary | null>(null);
  const [v, setV] = useState('');
  const [n, setN] = useState('');
  useEffect(() => { sessionSummary(session).then(setSum); }, [session]);
  const diff = useMemo(() => (sum ? round2(parseNum(v) - sum.expectedCash) : 0), [v, sum]);
  if (!sum) return null;
  return (
    <Modal title="Fechar caixa" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Voltar (Esc)</button><button className="btn primary" onClick={() => onClosed(parseNum(v), n || undefined)}>Fechar caixa e imprimir</button></>}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="spread"><span>Vendas</span><b>{sum.salesCount}</b></div>
          {Object.entries(sum.byMethod).map(([k, val]) => <div key={k} className="spread"><span>{PAYMENT_LABELS[k]}</span><b>{money(val)}</b></div>)}
          <div className="spread"><span>Fundo de troco</span><b>{money(session.openingAmount)}</b></div>
          <div className="spread"><span>Suprimentos</span><b>+ {money(sum.suprimentos)}</b></div>
          <div className="spread"><span>Sangrias</span><b>− {money(sum.sangrias)}</b></div>
          <div className="spread" style={{ borderTop: '2px solid var(--line)', paddingTop: 8 }}><b>Total vendido</b><b>{money(sum.total)}</b></div>
        </div>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="stat"><span className="muted small">Dinheiro esperado na gaveta</span><b>{money(sum.expectedCash)}</b></div>
          <div className="field"><label htmlFor="cc">Dinheiro contado</label><input id="cc" className="input big" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></div>
          {v && <div className={'chip ' + (Math.abs(diff) < 0.01 ? 'ok' : 'warn')} style={{ fontSize: 15, padding: 12 }}>Diferença: {money(diff)}</div>}
          <div className="field"><label htmlFor="cn">Observação</label><input id="cn" value={n} onChange={(e) => setN(e.target.value)} /></div>
          <span className="muted small">Ao fechar, um backup é gerado automaticamente.</span>
        </div>
      </div>
    </Modal>
  );
}

/** F10: sangria, suprimento e fechamento do caixa. */
function MovModal({ canClose, onClose, onPick }: { canClose: boolean; onClose: () => void; onPick: (k: 'sangria' | 'suprimento' | 'close') => void }) {
  const opts: ['1' | '2' | '3', 'sangria' | 'suprimento' | 'close', string][] = [['1', 'sangria', 'Sangria (retirar dinheiro)'], ['2', 'suprimento', 'Suprimento (colocar dinheiro)'], ['3', 'close', 'Fechar caixa']];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const o = opts.find((x) => x[0] === e.key);
      if (o && (o[1] !== 'close' || canClose)) { e.preventDefault(); onPick(o[1]); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <Modal title="Movimento do caixa" onClose={onClose} footer={<button className="btn" onClick={onClose}>Voltar (Esc)</button>}>
      <div className="pay-grid">
        {opts.map(([k, id, label]) => (
          <button key={k} type="button" className="pay-opt" disabled={id === 'close' && !canClose} onClick={() => onPick(id)}><b>{k}</b>{label}</button>
        ))}
      </div>
      {!canClose && <span className="muted small">Para fechar o caixa, termine ou cancele a venda em andamento.</span>}
    </Modal>
  );
}
