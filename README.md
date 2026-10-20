# Vision PDV

Sistema de frente de caixa (PDV) para supermercado que **funciona sem internet**.
Tudo é salvo no próprio aparelho, há backup automático e, quando a internet volta,
os dados vão para a nuvem (Cloudflare D1) e chegam aos outros caixas.

Um único sistema roda em:

| Onde | Como |
| --- | --- |
| **Site** | https://visionpdv.marcatoapp.com.br (funciona offline depois do primeiro acesso) |
| **Windows** | Instalador `.exe` (Electron), com backup numa pasta do PC e impressão direta |
| **Android** | App `.apk` (Capacitor) |
| **iOS** | Projeto Xcode pronto em `app/ios` (precisa de um Mac e de conta Apple para publicar) |

## O que o sistema faz

- **Frente de caixa**: tela "Próximo cliente", leitor de código de barras, foto do produto ao bipar,
  quantidade (`F3` ou `3*código`), etiqueta de balança (código começando com 2), busca (`F5`),
  cancelar item (`F6`) ou a venda (`Ctrl+F6`), desconto (`F4`), CPF na nota e cliente (`F7`).
- **Pagamento** (`F10`) numa janela com atalhos: 1 Dinheiro (com troco), 2 PIX, 3 Débito, 4 Crédito,
  5 Crédito parcelado, 6 Vale-alimentação, 7 Crediário/fiado, 8 Dividir pagamento.
- **Caixa**: abertura com fundo de troco, sangria (`F8`), suprimento (`F9`), fechamento com conferência (`F11`).
- **Cupom** não fiscal em impressora térmica 80 mm ou 58 mm.
- **Produtos**: cadastro com código de barras, descritivo, marca, fabricante, cesta, categoria,
  subcategoria, conteúdo, preços (custo, margem, venda, atacado), estoque mínimo, NCM/CEST/CFOP e foto.
- **Importar planilha do Excel** (.xlsx, .xls, .csv) ligando cada coluna a um campo.
- **Estoque**: entrada, ajuste, histórico e avisos de estoque baixo.
- **Clientes e crediário**: limite, saldo devedor e recebimento de pagamentos.
- **Vendas**, **Caixas** e **Painel** com faturamento, ticket médio, vendas por hora/dia, formas de pagamento,
  produtos mais vendidos e exportação CSV.
- **Usuários** com funções: administrador, gerente e operador de caixa.
- **Configurações**: nome e logo da loja, **cores escolhidas pela loja** (padrão verde e lilás Vision),
  número do caixa, impressora, balança, nuvem e backup.
- **Backup automático** todo dia e a cada fechamento de caixa (guarda os últimos 30), com restauração.

> Ainda não emite NFC-e (nota fiscal eletrônica). Isso exige certificado digital e integração com a SEFAZ
> e pode ser a próxima etapa.

## Estrutura

```
app/       Sistema (React + Vite). Banco local: IndexedDB (Dexie).
  android/ Projeto Android (Capacitor)
  ios/     Projeto iOS (Capacitor)
desktop/   App de Windows (Electron)
worker/    Servidor da nuvem (Cloudflare Worker + D1), que também entrega o site
```

## 1. Nuvem, lojas e links

Tudo fica em **https://visionpdv.marcatoapp.com.br** (site + servidor). O banco é o `vision-pdv-db` na Cloudflare.

- **Cada tela tem seu link**: `/pdv` (frente de caixa), `/painel`, `/produtos`, `/importar`, `/estoque`,
  `/clientes`, `/vendas`, `/caixas`, `/usuarios`, `/config`, `/login`.
- **Cadastro aberto com teste grátis**: na página inicial, *Criar minha loja* pede nome, e-mail e WhatsApp e libera
  **7 dias grátis** (`TRIAL_DAYS` no `wrangler.toml`). Limite de 3 lojas por internet por dia.
- **Assinatura**: quando vence, a frente de caixa trava (os dados continuam salvos) e aparecem *Comprar* e
  *Tenho uma chave de ativação*. Chaves `VPDV-XXXX-XXXX-XXXX` somam 30, 90, 180 ou 365 dias.
  O botão *Comprar* aparece quando `CHECKOUT_URL` é preenchido no `wrangler.toml`.
- **Painel do dono**: `https://visionpdv.marcatoapp.com.br/dono`, com a **chave mestra** (segredo `API_KEY`).
  Mostra todas as lojas (contato, situação, vencimento), gera chaves de ativação e dá dias ou bloqueia lojas.
- **Aparelho novo**: abra `https://visionpdv.marcatoapp.com.br/?loja=codigo-da-loja` (ou digite o código na página inicial)
  e entre com usuário e senha. O login é conferido na nuvem e os dados são baixados. Depois funciona offline.
  No app de Windows e no celular, digite o código da loja.
- **Recomeçar neste aparelho** (na tela de login) apaga só os dados locais; a nuvem continua com tudo.

Publicação automática pelo GitHub (workflow **Publicar na Cloudflare**) quando a `main` muda. Segredos necessários
em **Settings › Secrets and variables › Actions**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e
`VISION_API_KEY` (a chave mestra).

## Atualizações

O app de Windows e o de Android abrem o sistema direto da nuvem e guardam uma cópia no aparelho para funcionar
sem internet. Toda publicação nova chega a todos os aparelhos: aparece o aviso **"Nova versão disponível · Atualizar
agora"** (no caixa, só com o caixa livre) e há o botão em **Configurações › Atualizações**. Não precisa reinstalar.

## 2. Instaladores (Windows e Android)

Os instaladores são gerados pelo GitHub automaticamente:

1. Envie um commit com `[gerar-instalador]` na mensagem (ou rode **Actions › Gerar instaladores**).
2. Ao terminar, o `.exe` (Windows) e o `.apk` (Android) ficam na página **Releases**.

Também roda sozinho ao criar uma tag `v1.0.0`, `v1.0.1`…

## iOS

Precisa de um Mac com Xcode:

```bash
cd app
npm install
npm run ios        # gera o build e abre o Xcode
```

No Xcode, escolha sua conta Apple em *Signing & Capabilities* e rode no iPhone ou envie para a App Store.

## Desenvolvimento

```bash
cd app && npm install && npm run dev          # abre em http://localhost:5173
cd worker && npm install && npm run dev       # servidor local (crie worker/.dev.vars com API_KEY=teste)
cd desktop && npm install && npm start        # app de Windows (depois de "npm run build" no app)
```

## Como a sincronização funciona

- Cada alteração (venda, produto, cliente…) é gravada no aparelho e entra numa **fila**.
- A cada 20 segundos, e quando a internet volta, o app envia a fila e baixa o que mudou nos outros aparelhos.
- O estoque é calculado pela soma dos movimentos (venda, entrada, ajuste). Assim dois caixas vendendo
  o mesmo produto ao mesmo tempo nunca se sobrescrevem.
- Se o mesmo cadastro for editado em dois lugares, vale a alteração mais recente.

## Senha, avisos, anúncios e cobrança automática

Tudo é configurado em `/dono` → **Planos e pagamento**:

- **Esqueci minha senha** (`/esqueci` → link `/redefinir?t=…`, vale 1 hora). Envia por e-mail (Resend) e, para o administrador, também no WhatsApp da loja (Z-API).
- **Avisos de vencimento** às 9h (Brasília): 3 dias antes, no dia e 1 dia depois. Lojas com cobrança automática ativa só recebem o aviso de vencido.
- **Pixels**: Meta Pixel e Google (tag G-/AW- e rótulos de conversão). Carregam só no site. Eventos: visita, cadastro, assinatura paga.
- **Cobrança automática** (assinatura recorrente do Mercado Pago, `/preapproval`). Webhook: `https://visionpdv.marcatoapp.com.br/api/billing/webhook` com os eventos Pagamentos e Planos e assinaturas.
- Banco: rode `worker/migrate-3.sql` em bancos criados antes desta versão.
