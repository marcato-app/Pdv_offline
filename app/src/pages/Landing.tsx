import { useEffect, useState } from 'react';
import { getPlatform, whatsLink, type PlatformInfo } from '../lib/platform';
import { money } from '../lib/format';
import { initTracking } from '../lib/tracking';

// Página de vendas (para quem chega pelo anúncio). Botões levam para /cadastro e /entrar.

const FEATURES: [string, string][] = [
  ['Vende sem internet', 'Caiu a internet? O caixa continua vendendo. Tudo é enviado para a nuvem quando a conexão volta.'],
  ['PIX com QR na tela', 'O cliente paga e a venda fecha sozinha. Também manda o valor direto para a maquininha.'],
  ['Cadastro automático', 'Bipou um produto novo? Nome, marca, categoria e foto aparecem sozinhos.'],
  ['Resumo no WhatsApp', 'Todo dia você recebe as vendas, o que está acabando e as contas que vencem.'],
  ['Lista de compras pronta', 'O sistema calcula o que comprar e manda o pedido para o fornecedor no WhatsApp.'],
  ['Validade e perdas', 'Avisa o que vai vencer para você fazer promoção antes de jogar fora.'],
  ['Estoque, fiado e financeiro', 'Clientes com crediário, boletos, salários e o resultado do mês num lugar só.'],
  ['Computador, celular e tablet', 'Windows, Android e navegador. Cada caixa com seu número, tudo junto na nuvem.'],
];

const FAQ: [string, string][] = [
  ['Preciso de cartão para testar?', 'Não. Você usa 7 dias grátis com tudo liberado e só paga se gostar.'],
  ['Funciona mesmo sem internet?', 'Sim. As vendas ficam salvas no aparelho e vão para a nuvem sozinhas quando a internet volta.'],
  ['Consigo importar meus produtos?', 'Sim. Importe sua planilha do Excel e o sistema liga as colunas automaticamente.'],
  ['Funciona com leitor de código e balança?', 'Sim. Leitor USB ou Bluetooth, etiqueta de balança de açougue e balança ligada no computador.'],
  ['Emite nota fiscal (NFC-e)?', 'Ainda não. Por enquanto emite cupom não fiscal. A NFC-e está a caminho.'],
  ['Posso cancelar quando quiser?', 'Sim. Não tem fidelidade nem multa.'],
];

export function Landing() {
  const [p, setP] = useState<PlatformInfo | null>(null);
  useEffect(() => { getPlatform().then(setP); initTracking(); }, []);
  const plans = p?.plans || [];
  const monthly = plans.find((x) => x.days <= 31);
  const go = (path: string) => () => location.assign(path);

  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-wrap lp-bar">
          <span className="lp-brand"><img src="/icon.svg" alt="" width={36} height={36} />Vision PDV</span>
          <nav className="lp-links">
            <a href="#recursos">Recursos</a>
            <a href="#precos">Preços</a>
            <a href="#duvidas">Dúvidas</a>
            <button className="btn sm" onClick={go('/entrar')}>Entrar</button>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-text">
            <span className="chip ok">7 dias grátis · sem cartão</span>
            <h1>O caixa do seu mercado que <em>não para</em> quando a internet cai.</h1>
            <p>Frente de caixa, estoque, PIX com QR, fiado e financeiro para mercadinhos, açougues e padarias. Funciona no computador, no celular e no tablet.</p>
            <div className="row">
              <button className="btn primary big" onClick={go('/cadastro')}>Testar 7 dias grátis</button>
              {monthly && <span className="muted">depois, a partir de <b>{money(monthly.price)}</b>/mês</span>}
            </div>
          </div>
          <div className="lp-mock" aria-hidden="true">
            <div className="lp-mock-head"><span />Caixa 01 · Online</div>
            <div className="lp-mock-item"><span className="lp-ph" /><div><b>FEIJÃO CARIOCA 1KG</b><small>2 × R$ 8,49</small></div><b className="lp-green">R$ 16,98</b></div>
            <div className="lp-mock-row"><span>Arroz Branco 5kg</span><b>27,90</b></div>
            <div className="lp-mock-row"><span>Leite Integral 1L</span><b>28,74</b></div>
            <div className="lp-mock-row"><span>Banana Prata 1,235 kg</span><b>8,63</b></div>
            <div className="lp-mock-total"><span>TOTAL</span><b>R$ 82,25</b></div>
            <div className="lp-mock-pay"><span>PIX</span><span>Dinheiro</span><span>Cartão</span></div>
          </div>
        </div>
      </section>

      <section id="recursos" className="lp-sec">
        <div className="lp-wrap">
          <h2>Tudo que o seu caixa precisa</h2>
          <div className="lp-grid">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="lp-card"><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-steps">
        <div className="lp-wrap">
          <h2>Comece em 10 minutos</h2>
          <ol>
            <li><b>Crie sua loja</b><span>Só nome, e-mail e senha.</span></li>
            <li><b>Importe seus produtos</b><span>Planilha do Excel ou bipando: o cadastro se preenche sozinho.</span></li>
            <li><b>Abra o caixa e venda</b><span>Leitor de código, PIX na tela e cupom na impressora térmica.</span></li>
          </ol>
        </div>
      </section>

      <section id="precos" className="lp-sec">
        <div className="lp-wrap">
          <h2>Preço simples</h2>
          <p className="muted" style={{ textAlign: 'center', margin: '0 0 24px' }}>Todos os recursos em todos os planos. Sem fidelidade.</p>
          <div className="lp-plans">
            {plans.map((pl) => (
              <div key={pl.id} className={'lp-plan' + (pl.highlight ? ' hot' : '')}>
                {pl.highlight && <span className="chip ok">{pl.highlight}</span>}
                <h3>{pl.name}</h3>
                <div className="lp-price">{money(pl.price)}<small>/{pl.days >= 360 ? 'ano' : pl.days >= 85 && pl.days <= 95 ? 'trimestre' : 'mês'}</small></div>
                {pl.days >= 360 && <span className="muted small">equivale a {money(pl.price / 12)}/mês</span>}
                <button className={'btn big ' + (pl.highlight ? 'primary' : 'secondary')} onClick={go('/cadastro')}>Começar teste grátis</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="duvidas" className="lp-sec">
        <div className="lp-wrap lp-faq">
          <h2>Dúvidas frequentes</h2>
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-wrap" style={{ textAlign: 'center' }}>
          <h2>Teste agora, sem compromisso</h2>
          <button className="btn primary big" onClick={go('/cadastro')}>Criar minha loja grátis</button>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-bar">
          <span>© {new Date().getFullYear()} Vision PDV{p?.company ? ` · ${p.company}` : ''}</span>
          <nav className="lp-links">
            <a href="/termos">Termos de uso</a>
            <a href="/privacidade">Privacidade</a>
            {p?.supportWhatsApp && <a href={whatsLink(p.supportWhatsApp, 'Olá! Quero saber mais sobre o Vision PDV.')} target="_blank" rel="noreferrer">WhatsApp</a>}
          </nav>
        </div>
      </footer>

      {p?.supportWhatsApp && (
        <a className="wa-float" aria-label="Falar no WhatsApp" href={whatsLink(p.supportWhatsApp, 'Olá! Quero saber mais sobre o Vision PDV.')} target="_blank" rel="noreferrer">
          <WaIcon />
        </a>
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
