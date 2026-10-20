import { useEffect, useState } from 'react';
import { getPlatform, type PlatformInfo } from '../lib/platform';

// Termos de uso e Política de privacidade (LGPD). Os dados da empresa vêm do painel do dono.

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lp">
      <header className="lp-top"><div className="lp-wrap lp-bar"><a className="lp-brand" href="/"><img src="/icon.svg" alt="" width={36} height={36} />Vision PDV</a></div></header>
      <main className="lp-wrap legal"><h1>{title}</h1>{children}<p className="muted small">Última atualização: outubro de 2026.</p></main>
    </div>
  );
}

function useCompany() {
  const [p, setP] = useState<PlatformInfo | null>(null);
  useEffect(() => { getPlatform().then(setP); }, []);
  const who = p?.company ? `${p.company}${p.companyDoc ? `, inscrita sob ${p.companyDoc}` : ''}` : 'o responsável pelo Vision PDV';
  const mail = p?.companyEmail || 'o e-mail de suporte informado no site';
  return { who, mail };
}

export function Termos() {
  const { who, mail } = useCompany();
  return (
    <Shell title="Termos de uso">
      <p>Estes termos regem o uso do Vision PDV, sistema de frente de caixa e gestão oferecido por {who}. Ao criar uma loja você declara que leu e concorda com estes termos.</p>
      <h2>1. O serviço</h2>
      <p>O Vision PDV permite registrar vendas, produtos, estoque, clientes, contas e relatórios, com funcionamento offline e sincronização na nuvem. O cupom emitido é não fiscal; a emissão de documentos fiscais é de responsabilidade da loja.</p>
      <h2>2. Cadastro e acesso</h2>
      <p>Você é responsável pelas informações cadastradas, pela guarda das senhas e pelas ações feitas pelos usuários da sua loja. Avise o suporte se suspeitar de uso indevido.</p>
      <h2>3. Teste grátis, planos e pagamento</h2>
      <p>Lojas novas têm um período de teste grátis. Depois, o uso depende da contratação de um plano. O pagamento é feito por meios de pagamento de terceiros (como Mercado Pago). Sem pagamento, o sistema bloqueia novas vendas, mas os dados continuam guardados.</p>
      <h2>4. Cancelamento</h2>
      <p>Você pode deixar de renovar quando quiser, sem multa. Valores de períodos já pagos não são devolvidos, exceto quando a lei exigir. Mediante pedido, os dados da loja podem ser exportados ou apagados.</p>
      <h2>5. Disponibilidade e backups</h2>
      <p>Buscamos manter o serviço sempre disponível, mas podem ocorrer interrupções. O sistema faz backups automáticos no aparelho; recomendamos guardar cópias periódicas. Não nos responsabilizamos por perdas causadas por mau uso, falhas do aparelho ou de terceiros.</p>
      <h2>6. Uso adequado</h2>
      <p>É proibido usar o sistema para atividades ilegais, tentar acessar dados de outras lojas ou prejudicar o funcionamento do serviço.</p>
      <h2>7. Alterações</h2>
      <p>Estes termos podem ser atualizados. Mudanças importantes serão avisadas no sistema.</p>
      <h2>8. Contato e foro</h2>
      <p>Dúvidas: {mail}. Fica eleito o foro do domicílio do consumidor, conforme o Código de Defesa do Consumidor.</p>
    </Shell>
  );
}

export function Privacidade() {
  const { who, mail } = useCompany();
  return (
    <Shell title="Política de privacidade">
      <p>Esta política explica como {who} trata dados pessoais no Vision PDV, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>
      <h2>1. Dados que coletamos</h2>
      <p><b>Do responsável pela loja:</b> nome, e-mail, WhatsApp e dados da loja. <b>Dos usuários da loja:</b> nome, usuário, e-mail e senha (guardada embaralhada, nunca em texto). <b>Dados inseridos pela loja:</b> produtos, vendas, clientes (por exemplo nome, CPF e telefone para crediário), contas e funcionários.</p>
      <h2>2. Para que usamos</h2>
      <p>Para prestar o serviço (sincronizar aparelhos, fazer backups, gerar relatórios e resumos), cobrar a assinatura, dar suporte e enviar avisos importantes. Não vendemos dados.</p>
      <h2>3. Quem é responsável por cada dado</h2>
      <p>Para os dados de clientes e funcionários que a loja cadastra, a loja é a controladora e o Vision PDV atua como operador, tratando os dados apenas para prestar o serviço.</p>
      <h2>4. Compartilhamento</h2>
      <p>Com fornecedores necessários ao serviço: hospedagem em nuvem (Cloudflare), meios de pagamento (Mercado Pago) e serviços de envio de WhatsApp escolhidos pela loja. Também quando exigido por lei.</p>
      <h2>5. Segurança e guarda</h2>
      <p>Os dados trafegam com criptografia (HTTPS) e o acesso é protegido por senha. Guardamos os dados enquanto a loja usar o serviço e pelo prazo exigido por lei.</p>
      <h2>6. Seus direitos</h2>
      <p>Você pode pedir acesso, correção, exportação ou exclusão dos seus dados, e informações sobre o tratamento, pelo contato abaixo.</p>
      <h2>7. Contato</h2>
      <p>Encarregado de dados (DPO): {mail}.</p>
    </Shell>
  );
}
