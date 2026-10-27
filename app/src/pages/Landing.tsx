import { useEffect, useRef, useState } from 'react';
import { getPlatform, whatsLink, type PlatformInfo } from '../lib/platform';
import { money } from '../lib/format';
import { initTracking } from '../lib/tracking';
import { CookieBanner, CookieSettingsLink } from '../components/CookieBanner';
import './landing.css';

// Página de vendas (para quem chega pelo anúncio). Botões levam para /cadastro e /entrar.

const go = (path: string) => () => location.assign(path);

/** Faz os blocos surgirem suavemente quando entram na tela. */
function useReveal(deps: unknown[]) {
  useEffect(() => {
    // Só os blocos que ainda não apareceram (os planos chegam da nuvem depois e trocam com Mensal/Anual).
    const els = document.querySelectorAll('.v-reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((list) => list.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, deps);
}

function useFonts() {
  useEffect(() => {
    // Fundo escuro também atrás da página (rolagem elástica do iPhone).
    document.documentElement.style.background = '#0b0816';
    document.body.style.background = '#0b0816';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b0816');
    if (document.getElementById('v-fonts')) return;
    const l = document.createElement('link');
    l.id = 'v-fonts';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
    document.head.appendChild(l);
  }, []);
}

const Arrow = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const Check = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Cross = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

// ---------- Demonstração animada do caixa ----------
const DEMO = [
  { e: '🍚', n: 'ARROZ TIPO 1 5KG', q: '1 un', v: 27.9 },
  { e: '🥛', n: 'LEITE INTEGRAL 1L', q: '6 un', v: 29.94 },
  { e: '🍌', n: 'BANANA PRATA', q: '1,235 kg', v: 8.63 },
  { e: '☕', n: 'CAFÉ TORRADO 500G', q: '1 un', v: 18.49 },
  { e: '🧀', n: 'QUEIJO MUÇARELA', q: '0,412 kg', v: 16.44 },
];

function PdvDemo() {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [step, setStep] = useState(reduce ? DEMO.length + 2 : 0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setStep((s) => (s >= DEMO.length + 4 ? 0 : s + 1)), 1300);
    return () => clearInterval(t);
  }, []);
  const items = DEMO.slice(0, Math.min(step, DEMO.length));
  const total = items.reduce((s, x) => s + x.v, 0);
  const last = items[items.length - 1];
  const paying = step >= DEMO.length + 1;
  const paid = step >= DEMO.length + 2;
  return (
    <div className="v-stage" aria-hidden="true">
      <div className="v-laptop">
        <div className="v-screen">
          <div className="v-pdv-head"><span className="v-logo-dot">M</span><b>Mercado Bom Preço</b><span className="v-online"><i />Online</span><span className="v-muted">Caixa 01 · Ana</span></div>
          <div className="v-pdv-body">
            <div className="v-pdv-left">
              <div className={'v-current' + (last ? ' on' : '')} key={step}>
                {last ? <><span className="v-ph">{last.e}</span><div><small>{last.q}</small><b>{last.n}</b></div><strong>{money(last.v)}</strong></> : <div className="v-next"><b>Próximo cliente</b><small>Bipe o primeiro produto</small></div>}
              </div>
              <div className="v-list">
                {items.map((x, i) => (
                  <div key={x.n} className="v-row"><span>{String(i + 1).padStart(2, '0')}</span><b>{x.n}</b><small>{x.q}</small><strong>{x.v.toFixed(2).replace('.', ',')}</strong></div>
                ))}
              </div>
            </div>
            <div className="v-pdv-right">
              <div className="v-total"><small>TOTAL</small><b>{money(total)}</b><span>{items.length} itens</span></div>
              <div className="v-pay">
                <span className={paying ? 'on' : ''}>PIX</span><span>Dinheiro</span><span>Débito</span><span>Crédito</span>
              </div>
              <div className="v-keys"><kbd>F1</kbd> Valor manual <kbd>F4</kbd> Quantidade <kbd>F10</kbd> Pagar</div>
            </div>
          </div>
        </div>
        <div className="v-base" />
      </div>

      <div className={'v-phone' + (paying ? ' show' : '')}>
        <div className="v-phone-in">
          <small>Pagar com PIX</small>
          <b>{money(total || 101.4)}</b>
          <div className="v-qr">{Array.from({ length: 49 }, (_, i) => <i key={i} className={(i * 7 + (i % 5) * 3) % 3 === 0 || [0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43].includes(i) ? 'on' : ''} />)}</div>
          <span className={'v-status' + (paid ? ' ok' : '')}>{paid ? 'Pagamento aprovado' : 'Esperando o pagamento…'}</span>
        </div>
      </div>

      <div className={'v-toast' + (paid ? ' show' : '')}><span><Check /></span><div><b>PIX recebido</b><small>Venda fechada sozinha · {money(total)}</small></div></div>
      <div className="v-float v-float-a"><span className="v-wifi" /><div><b>Caiu a internet?</b><small>O caixa continua vendendo</small></div></div>
    </div>
  );
}

// ---------- Mini-telas das funcionalidades ----------
function MiniOffline() {
  return (
    <div className="v-mini v-mini-off">
      <div className="v-sync"><span className="dot off" />Sem internet · 23 vendas guardadas</div>
      <div className="v-bar"><i style={{ width: '100%' }} /></div>
      <div className="v-sync"><span className="dot on" />Internet voltou · enviando para a nuvem</div>
      <div className="v-bar"><i className="anim" /></div>
    </div>
  );
}
function MiniScan() {
  return (
    <div className="v-mini v-mini-scan">
      <div className="v-barcode">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ width: [2, 1, 3, 1, 2][i % 5] }} />)}<span>7891000100103</span></div>
      <div className="v-arrow">↓</div>
      <div className="v-filled"><span className="v-ph sm">🥫</span><div><b>MILHO VERDE LATA 170G</b><small>Marca Quero · Mercearia › Enlatados</small></div><em>preenchido sozinho</em></div>
    </div>
  );
}
function MiniWhats() {
  return (
    <div className="v-mini v-mini-wa">
      <div className="v-bubble">
        <b>📊 Resumo de hoje · Mercado Bom Preço</b>
        <span>Vendas: <strong>R$ 4.382,90</strong> (187)</span>
        <span>Ticket médio: R$ 23,44</span>
        <span>⚠️ Acabando: Leite 1L, Açúcar 5kg</span>
        <span>📅 Vence amanhã: boleto Distribuidora</span>
        <small>20:00 ✓✓</small>
      </div>
    </div>
  );
}
function MiniChart() {
  const h = [38, 52, 44, 70, 58, 86, 74];
  return (
    <div className="v-mini v-mini-chart">
      <div className="v-kpis"><div><small>Faturamento</small><b>R$ 31,2 mil</b><em>+12%</em></div><div><small>Lucro bruto</small><b>R$ 8,9 mil</b><em>+8%</em></div></div>
      <div className="v-bars">{h.map((x, i) => <i key={i} style={{ height: `${x}%`, animationDelay: `${i * 80}ms` }} />)}</div>
    </div>
  );
}
function MiniStock() {
  return (
    <div className="v-mini v-mini-stock">
      {[['Iogurte morango', 'vence em 2 dias', 'warn'], ['Pão de forma', 'vence amanhã', 'bad'], ['Detergente 500ml', '3 un · comprar 24', 'info']].map(([n, s, k]) => (
        <div key={n} className="v-stock-row"><b>{n}</b><span className={'v-tag ' + k}>{s}</span></div>
      ))}
    </div>
  );
}

const FEATURES: { t: string; d: string; v: JSX.Element; wide?: boolean }[] = [
  { t: 'Cadastro que se preenche sozinho', d: 'Bipou um produto novo? Nome, marca, categoria e NCM aparecem na hora.', v: <MiniScan /> },
  { t: 'Resumo do dia no WhatsApp', d: 'Toda noite: quanto vendeu, o que está acabando e as contas que vencem.', v: <MiniWhats /> },
  { t: 'Vende sem internet', d: 'A internet caiu e a fila continua andando. As vendas ficam guardadas no aparelho e sobem para a nuvem sozinhas quando a conexão volta.', v: <MiniOffline />, wide: true },
  { t: 'Relatórios que você entende', d: 'Mais vendidos, lucro por categoria, marca e fabricante. Sem planilha.', v: <MiniChart />, wide: true },
  { t: 'Validade, perdas e compras', d: 'Avisa o que vai vencer e monta a lista de compras do fornecedor.', v: <MiniStock /> },
];

const EXTRAS = ['Balança de açougue e etiqueta', 'Leitor USB, Bluetooth ou câmera', 'Fiado (crediário) por cliente', 'Senha do gerente para cancelar', 'Sangria, suprimento e fechamento', 'Cupom com a sua logo', 'Boletos, contas e salários', 'Vários caixas, um só estoque'];

const COMPARE: [string, boolean | string, boolean | string, boolean | string][] = [
  ['Vende sem internet', false, 'às vezes', true],
  ['PIX que confirma sozinho', false, false, true],
  ['Funciona no celular', false, false, true],
  ['Cadastro automático pelo código', false, false, true],
  ['Resumo diário no WhatsApp', false, false, true],
  ['Instalação', '—', 'técnico', '10 minutos'],
  ['Fidelidade / multa', '—', 'sim', 'não'],
];

const FAQ: [string, string][] = [
  ['Preciso de cartão para testar?', 'Não. São 7 dias grátis com tudo liberado. Você só paga se quiser continuar.'],
  ['Funciona mesmo sem internet?', 'Sim. O caixa guarda tudo no aparelho e envia para a nuvem sozinho quando a internet volta. Você não perde nenhuma venda.'],
  ['Consigo trazer meus produtos?', 'Sim. Importe sua planilha do Excel (o sistema reconhece as colunas) ou vá bipando: o cadastro se preenche sozinho.'],
  ['Funciona com meu leitor, impressora e balança?', 'Leitores USB e Bluetooth, impressoras térmicas de cupom, etiquetas de balança de açougue e balanças ligadas no computador. No celular, a câmera vira leitor.'],
  ['Emite nota fiscal (NFC-e)?', 'Ainda não. Hoje emite cupom não fiscal. A NFC-e está a caminho.'],
  ['Posso cancelar quando quiser?', 'Sim, sem multa e sem fidelidade. Seus dados continuam salvos.'],
];

export function Landing() {
  const [p, setP] = useState<PlatformInfo | null>(null);
  const [yearly, setYearly] = useState(true);
  const [faq, setFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const [pastHero, setPastHero] = useState(false);
  useFonts();
  useReveal([p, yearly]);
  useEffect(() => { getPlatform().then(setP); initTracking(); }, []);
  useEffect(() => {
    const f = () => { setScrolled(scrollY > 8); setPastHero(scrollY > (heroRef.current?.offsetHeight || 600) - 200); };
    f();
    addEventListener('scroll', f, { passive: true });
    return () => removeEventListener('scroll', f);
  }, []);

  const plans = p?.plans || [];
  const monthly = plans.find((x) => x.days <= 31);
  const annual = plans.find((x) => x.days >= 360);
  const perDay = (annual ? annual.price / 365 : monthly ? monthly.price / 30 : 0);
  const wa = p?.supportWhatsApp ? whatsLink(p.supportWhatsApp, 'Olá! Quero saber mais sobre o Vision PDV.') : null;
  const shown = plans.filter((x) => (yearly ? x.days >= 360 : x.days < 360));
  const list = shown.length ? shown : plans;
  const saving = monthly && annual ? monthly.price * 12 - annual.price : 0;

  return (
    <div className="v">
      <header className={'v-nav' + (scrolled ? ' solid' : '')}>
        <div className="v-wrap v-nav-in">
          <a className="v-brand" href="/"><img src="/icon.svg" alt="" width={34} height={34} />Vision PDV</a>
          <nav className="v-links" aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#comparar">Comparar</a>
            <a href="#precos">Preços</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <div className="v-nav-cta">
            <a className="v-btn ghost sm" href="/entrar">Entrar</a>
            <a className="v-btn primary sm hide-s" href="/cadastro">Testar grátis</a>
          </div>
        </div>
      </header>

      <section className="v-hero" ref={heroRef}>
        <div className="v-glow g1" /><div className="v-glow g2" /><div className="v-grid-bg" />
        <div className="v-wrap v-hero-in">
          <div className="v-hero-text">
            <span className="v-badge"><i />Novo · PIX que fecha a venda sozinho</span>
            <h1>O caixa do seu mercado que <span className="v-grad">não para</span>.</h1>
            <p>Frente de caixa, estoque, PIX, fiado e financeiro para mercadinhos, açougues e padarias. Funciona até sem internet, no computador e no celular.</p>
            <div className="v-cta-row">
              <button className="v-btn primary lg" onClick={go('/cadastro')}>Começar 7 dias grátis <Arrow /></button>
              <a className="v-btn ghost lg" href="#recursos">Ver como funciona</a>
            </div>
            <ul className="v-proof">
              <li><Check />Sem cartão de crédito</li>
              <li><Check />Pronto em 10 minutos</li>
              <li><Check />Cancele quando quiser</li>
            </ul>
          </div>
          <PdvDemo />
        </div>
        <div className="v-wrap v-works">
          <span>Funciona com</span>
          <ul><li>Windows</li><li>Android</li><li>iPhone</li><li>Navegador</li><li>Mercado Pago</li><li>Impressora térmica</li><li>Balança</li><li>Leitor de código</li></ul>
        </div>
      </section>

      <section className="v-stats">
        <div className="v-wrap v-stats-in v-reveal">
          <div><b>2s</b><span>para registrar um item</span></div>
          <div><b>0</b><span>vendas perdidas sem internet</span></div>
          <div><b>{perDay ? money(perDay).replace('R$', 'R$ ') : 'R$ 2,19'}</b><span>por dia no plano anual</span></div>
          <div><b>7 dias</b><span>grátis, sem compromisso</span></div>
        </div>
      </section>

      <section id="recursos" className="v-sec">
        <div className="v-wrap">
          <div className="v-head v-reveal">
            <span className="v-kicker">Recursos</span>
            <h2>Tudo que o seu caixa precisa.<br /><span className="v-dim">Nada que complique.</span></h2>
          </div>
          <div className="v-bento">
            <article className="v-card v-card-pix v-reveal">
              <div className="v-card-txt">
                <span className="v-ico">⚡</span>
                <h3>PIX com QR na tela do caixa</h3>
                <p>O cliente aponta o celular, paga e a venda fecha sozinha. Sem conferir extrato, sem golpe de comprovante falso. Também manda o valor direto para a maquininha.</p>
              </div>
              <div className="v-pix-vis" aria-hidden="true">
                <div className="v-pix-card"><small>Total</small><b>R$ 82,25</b><div className="v-qr sm">{Array.from({ length: 49 }, (_, i) => <i key={i} className={(i * 5 + (i % 4)) % 3 === 0 || [0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43].includes(i) ? 'on' : ''} />)}</div></div>
                <div className="v-pix-ok"><span><Check /></span>Aprovado em 3 segundos</div>
              </div>
            </article>
            {FEATURES.map((f) => (
              <article key={f.t} className={'v-card v-reveal' + (f.wide ? ' wide' : '')}>
                {f.v}
                <div className="v-card-txt"><h3>{f.t}</h3><p>{f.d}</p></div>
              </article>
            ))}
          </div>
          <div className="v-extras v-reveal">
            {EXTRAS.map((x) => <span key={x}><Check />{x}</span>)}
          </div>
        </div>
      </section>

      <section className="v-sec v-steps-sec">
        <div className="v-wrap">
          <div className="v-head v-reveal">
            <span className="v-kicker">Comece hoje</span>
            <h2>Do cadastro à primeira venda em <span className="v-grad">10 minutos</span>.</h2>
          </div>
          <ol className="v-steps">
            <li className="v-reveal"><b>1</b><h3>Crie sua loja</h3><p>Nome, e-mail e senha. Sem cartão, sem instalar nada.</p></li>
            <li className="v-reveal"><b>2</b><h3>Traga seus produtos</h3><p>Importe a planilha do Excel ou vá bipando: o cadastro se completa sozinho.</p></li>
            <li className="v-reveal"><b>3</b><h3>Abra o caixa e venda</h3><p>Leitor de código, PIX na tela e cupom na impressora térmica.</p></li>
          </ol>
        </div>
      </section>

      <section id="comparar" className="v-sec">
        <div className="v-wrap">
          <div className="v-head v-reveal">
            <span className="v-kicker">Comparar</span>
            <h2>Por que trocar o caderno<br /><span className="v-dim">(ou o sistema antigo)?</span></h2>
          </div>
          <div className="v-compare v-reveal" role="table" aria-label="Comparação">
            <div className="v-cmp-row head" role="row"><span role="columnheader" /><span role="columnheader">Caderno</span><span role="columnheader">Sistema antigo</span><span role="columnheader" className="me">Vision PDV</span></div>
            {COMPARE.map(([t, a, b, c]) => (
              <div key={t} className="v-cmp-row" role="row">
                <span role="rowheader">{t}</span>
                {[a, b, c].map((v, i) => (
                  <span key={i} role="cell" className={i === 2 ? 'me' : ''}>{v === true ? <em className="yes"><Check /></em> : v === false ? <em className="no"><Cross /></em> : v}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="precos" className="v-sec">
        <div className="v-wrap">
          <div className="v-head v-reveal">
            <span className="v-kicker">Preços</span>
            <h2>Um preço. <span className="v-grad">Tudo incluso.</span></h2>
            <p>Todos os recursos em todos os planos. Sem taxa de instalação, sem fidelidade.</p>
          </div>
          {monthly && annual && (
            <div className="v-toggle v-reveal" role="group" aria-label="Período">
              <button className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>Mensal</button>
              <button className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>Anual {saving > 0 && <em>economize {money(saving)}</em>}</button>
            </div>
          )}
          <div className="v-plans">
            {list.map((pl) => {
              const yr = pl.days >= 360;
              return (
                <div key={pl.id} className={'v-plan v-reveal' + (yr || pl.highlight ? ' hot' : '')}>
                  {pl.highlight && <span className="v-plan-tag">{pl.highlight}</span>}
                  <h3>Plano {pl.name}</h3>
                  <div className="v-price">
                    <b>{money(yr ? pl.price / 12 : pl.price)}</b><small>/mês</small>
                  </div>
                  <span className="v-dim">{yr ? `${money(pl.price)} por ano · ${money(pl.price / 365)} por dia` : `cobrado todo mês · ${money(pl.price / 30)} por dia`}</span>
                  <button className="v-btn primary lg block" onClick={go('/cadastro')}>Testar 7 dias grátis <Arrow /></button>
                  <ul>
                    {['Caixas e aparelhos ilimitados', 'PIX com confirmação automática', 'Funciona sem internet', 'Estoque, fiado e financeiro', 'Relatórios e resumo no WhatsApp', 'Suporte pelo WhatsApp'].map((x) => <li key={x}><Check />{x}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="v-center v-dim v-reveal">Pague com PIX ou cartão. No cartão, a renovação é automática e você cancela com um toque.</p>
        </div>
      </section>

      <section id="duvidas" className="v-sec">
        <div className="v-wrap v-faq">
          <div className="v-head v-reveal"><span className="v-kicker">Dúvidas</span><h2>Perguntas frequentes</h2></div>
          {FAQ.map(([q, a], i) => (
            <div key={q} className={'v-q v-reveal' + (faq === i ? ' open' : '')}>
              <button aria-expanded={faq === i} onClick={() => setFaq(faq === i ? null : i)}>{q}<span>+</span></button>
              <div className="v-a"><p>{a}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="v-sec">
        <div className="v-wrap">
          <div className="v-final v-reveal">
            <div className="v-glow g3" />
            <h2>Seu próximo cliente já está na fila.</h2>
            <p>Crie sua loja agora e faça a primeira venda ainda hoje.</p>
            <div className="v-cta-row center">
              <button className="v-btn white lg" onClick={go('/cadastro')}>Criar minha loja grátis <Arrow /></button>
              {wa && <a className="v-btn ghost lg" href={wa} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}
            </div>
          </div>
        </div>
      </section>

      <footer className="v-foot">
        <div className="v-wrap v-foot-in">
          <a className="v-brand" href="/"><img src="/icon.svg" alt="" width={28} height={28} />Vision PDV</a>
          <nav aria-label="Links">
            <a href="/entrar">Entrar</a>
            <a href="/termos">Termos de uso</a>
            <a href="/privacidade">Privacidade</a>
            <CookieSettingsLink />
            {wa && <a href={wa} target="_blank" rel="noreferrer">Suporte</a>}
          </nav>
          <span className="v-dim">© {new Date().getFullYear()} Vision PDV{p?.company ? ` · ${p.company}` : ''}{p?.companyDoc ? ` · ${p.companyDoc}` : ''}</span>
        </div>
      </footer>

      <CookieBanner />
      <div className={'v-sticky' + (pastHero ? ' show' : '')}>
        <div><b>7 dias grátis</b><small>sem cartão</small></div>
        <button className="v-btn primary" onClick={go('/cadastro')}>Começar <Arrow /></button>
      </div>

      {wa && (
        <a className="wa-float v-wa" aria-label="Falar no WhatsApp" href={wa} target="_blank" rel="noreferrer"><WaIcon /></a>
      )}
    </div>
  );
}

export function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8 19.6l-4.5.9z" />
      <path d="M9 9.5c.3 1.6 1.9 3.6 3.6 4.4l1.1-1.1 2 .9c-.2 1.2-1.2 1.8-2.2 1.6-2.9-.6-5.6-3.3-6.1-6.2-.2-1 .4-2 1.6-2.2l.9 2-1 .9" />
    </svg>
  );
}
