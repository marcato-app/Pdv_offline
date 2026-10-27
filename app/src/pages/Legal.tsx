import { useEffect, useState } from 'react';
import { getPlatform, type PlatformInfo } from '../lib/platform';

// Termos de uso e Política de privacidade (LGPD). Os dados da empresa vêm do painel do dono.

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lp">
      <header className="lp-top"><div className="lp-wrap lp-bar"><a className="lp-brand" href="/"><img src="/icon.svg" alt="" width={36} height={36} />Vision PDV</a></div></header>
      <main className="lp-wrap legal"><h1>{title}</h1>{children}<p className="muted small">Última atualização: 27 de outubro de 2026.</p></main>
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
      <h2>4. Cancelamento e reembolso</h2>
      <p>Você pode cancelar a assinatura quando quiser, sem multa, pelo próprio sistema (Configurações → Assinatura) ou pelo suporte. O acesso continua até o fim do período já pago.</p>
      <p><b>Direito de arrependimento:</b> por ser uma contratação feita pela internet, você pode desistir em até 7 dias corridos depois do primeiro pagamento e receber o valor de volta integralmente (art. 49 do Código de Defesa do Consumidor). Basta pedir pelo contato abaixo. O reembolso é feito pelo mesmo meio de pagamento, em até 10 dias úteis depois do pedido (no cartão, o prazo para aparecer na fatura depende da operadora).</p>
      <p>Depois desses 7 dias, valores de períodos já pagos não são devolvidos, exceto quando a lei exigir ou em caso de falha nossa que impeça o uso do sistema. Mediante pedido, os dados da loja podem ser exportados ou apagados.</p>
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
      <h2>4. Compartilhamento e serviços de terceiros</h2>
      <p>Só compartilhamos dados com os fornecedores necessários ao serviço, cada um para uma finalidade:</p>
      <ul>
        <li><b>Cloudflare</b>: hospedagem do site e do banco de dados na nuvem.</li>
        <li><b>Mercado Pago</b>: cobrança da assinatura e, se a loja ligar, recebimento de PIX e cartão no caixa. Os dados do cartão são digitados direto no Mercado Pago; nós não vemos nem guardamos.</li>
        <li><b>Serviço de e-mail (Resend)</b>: envio de e-mails do sistema, como a troca de senha.</li>
        <li><b>Serviço de WhatsApp (Z-API)</b>: avisos e resumos no WhatsApp cadastrado.</li>
        <li><b>Meta (Facebook/Instagram) e Google</b>: só no site, e só se você aceitar os cookies, para medir os resultados dos nossos anúncios.</li>
        <li><b>GitHub</b>: hospedagem dos arquivos de instalação do aplicativo.</li>
      </ul>
      <p>Também compartilhamos quando exigido por lei ou ordem judicial.</p>
      <h2>5. Cookies</h2>
      <p>O sistema usa o armazenamento do navegador para funcionar (manter o login, guardar os dados para uso sem internet e as suas preferências). Esses são necessários e não servem para propaganda.</p>
      <p>No site, os cookies de medição de anúncios (Meta e Google) só são ativados se você clicar em "Aceitar" no aviso de cookies. Você pode mudar a escolha a qualquer momento pelo link "Cookies" no rodapé do site. Esses cookies nunca são usados dentro do sistema da loja nem no aplicativo.</p>
      <h2>6. Segurança e guarda</h2>
      <p>Os dados trafegam com criptografia (HTTPS), o acesso é protegido por senha e há bloqueio automático depois de várias tentativas de senha erradas. Cada loja só tem acesso aos próprios dados. Guardamos os dados enquanto a loja usar o serviço e pelo prazo exigido por lei; ao excluir a conta, os dados são apagados.</p>
      <h2>7. Seus direitos</h2>
      <p>Você pode pedir acesso, correção, exportação ou exclusão dos seus dados, e informações sobre o tratamento, pelo contato abaixo.</p>
      <h2>8. Contato</h2>
      <p>Encarregado de dados (DPO): {mail}.</p>
    </Shell>
  );
}
