-- Banco online do Vision PDV (Cloudflare D1).
-- Cada registro do app (produto, venda, cliente...) fica guardado como JSON.
-- "seq" cresce a cada alteração, para cada aparelho baixar só o que mudou.
CREATE TABLE IF NOT EXISTS records (
  store_id   TEXT    NOT NULL,
  tbl        TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (store_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (store_id, seq);
CREATE INDEX IF NOT EXISTS records_tbl ON records (store_id, tbl, updated_at);

-- Lojas. O "id" é o código da loja (aparece no link de convite ?loja=<id>).
-- Licença: a loja pode usar até a maior data entre trial_ends (teste grátis) e paid_until (pago).
CREATE TABLE IF NOT EXISTS stores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  created_at  INTEGER NOT NULL,
  created_ip  TEXT,
  trial_ends  INTEGER NOT NULL,
  paid_until  INTEGER NOT NULL DEFAULT 0,
  plan        TEXT,
  blocked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stores_ip ON stores (created_ip, created_at);

-- Chaves de ativação vendidas (cada uma soma "days" dias à loja que usar).
CREATE TABLE IF NOT EXISTS licenses (
  code       TEXT PRIMARY KEY,
  days       INTEGER NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  used_by    TEXT,
  used_at    INTEGER
);

-- Pagamentos já processados (para não ativar duas vezes o mesmo pagamento).
CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL,
  days       INTEGER NOT NULL,
  amount     REAL,
  provider   TEXT,
  created_at INTEGER NOT NULL
);

-- Banco de produtos compartilhado (cadastro automático pelo código de barras).
CREATE TABLE IF NOT EXISTS catalog (
  barcode      TEXT PRIMARY KEY,
  description  TEXT,
  brand        TEXT,
  manufacturer TEXT,
  category     TEXT,
  subcategory  TEXT,
  basket       TEXT,
  content      TEXT,
  ncm          TEXT,
  photo        TEXT,
  source       TEXT,
  uses         INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Credenciais de cada loja (Mercado Pago, WhatsApp). Ficam só no servidor.
CREATE TABLE IF NOT EXISTS store_secrets (
  store_id   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Resumos de WhatsApp já enviados (um por loja por dia).
CREATE TABLE IF NOT EXISTS wa_log (
  store_id TEXT NOT NULL,
  day      INTEGER NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (store_id, day)
);
