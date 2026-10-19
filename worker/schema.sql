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
