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

## 1. Nuvem e site (Cloudflare)

Tudo fica em **https://visionpdv.marcatoapp.com.br**: o site e o servidor que sincroniza os caixas.
O banco `vision-pdv-db` já foi criado na conta da Cloudflare, com as tabelas.

A publicação é automática pelo GitHub (workflow **Publicar na Cloudflare**) sempre que a branch `main` muda.
Ela precisa de 3 segredos em **Settings › Secrets and variables › Actions**:

| Segredo | O que é |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token criado na Cloudflare em *My Profile › API Tokens*, modelo **Edit Cloudflare Workers**, com permissão extra **D1: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta (aparece no painel da Cloudflare, na lateral da página *Workers & Pages*) |
| `VISION_API_KEY` | Uma senha longa inventada por você. É a **chave de acesso** que os caixas usam |

No sistema: **Configurações › Nuvem** já vem com o endereço. Basta colocar a chave, **Testar conexão** e **Salvar**.
Para os outros caixas, celulares e tablets: na primeira tela escolha **Conectar a uma loja existente**
e use a mesma chave. Em **Configurações › Caixa**, dê um número diferente para cada caixa (01, 02, 03…).

## 2. Instaladores (Windows e Android)

Os instaladores são gerados pelo GitHub automaticamente:

1. No GitHub, abra a aba **Actions** › **Gerar instaladores** › **Run workflow**.
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
