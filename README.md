# Vision PDV

Sistema de frente de caixa (PDV) para supermercado que **funciona sem internet**.
Tudo é salvo no próprio aparelho, há backup automático e, quando a internet volta,
os dados vão para a nuvem (Cloudflare D1) e chegam aos outros caixas.

Um único sistema roda em:

| Onde | Como |
| --- | --- |
| **Site** | Cloudflare Pages (abre no navegador e funciona offline depois do primeiro acesso) |
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
worker/    Servidor da nuvem (Cloudflare Worker + D1)
```

## 1. Colocar a nuvem no ar (Cloudflare)

Precisa ter uma conta grátis na Cloudflare e Node.js instalado.

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create vision-pdv        # copie o "database_id" que aparecer
# cole o id em worker/wrangler.toml, no lugar de COLOQUE-AQUI-O-ID-DO-BANCO
npm run db:init                           # cria a tabela no banco
npx wrangler secret put API_KEY           # digite uma senha longa: é a "chave de acesso"
npm run deploy                            # mostra o endereço, ex.: https://vision-pdv-api.SEU-USUARIO.workers.dev
```

Depois, no sistema: **Configurações › Nuvem**, coloque o endereço e a chave, toque em **Testar conexão** e **Salvar**.

Para os outros caixas, celulares e tablets: na primeira tela escolha **Conectar a uma loja existente**
e use o mesmo endereço e chave. Em **Configurações › Caixa**, dê um número diferente para cada caixa (01, 02, 03…).

## 2. Instaladores (Windows e Android)

Os instaladores são gerados pelo GitHub automaticamente:

1. No GitHub, abra a aba **Actions** › **Gerar instaladores** › **Run workflow**.
2. Ao terminar, o `.exe` (Windows) e o `.apk` (Android) ficam na página **Releases**.

Também roda sozinho ao criar uma tag `v1.0.0`, `v1.0.1`…

## 3. Site (Cloudflare Pages)

Em **Settings › Secrets and variables › Actions** do repositório, crie `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID`. Depois rode **Actions › Publicar na Cloudflare**. Ele publica o servidor e o site.

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
