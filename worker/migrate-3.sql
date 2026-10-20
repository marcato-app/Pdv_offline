-- Cobrança automática (assinatura recorrente do Mercado Pago)
ALTER TABLE stores ADD COLUMN sub_id TEXT;
ALTER TABLE stores ADD COLUMN sub_status TEXT;
ALTER TABLE stores ADD COLUMN sub_plan TEXT;
-- Recuperação de senha
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_email ON password_resets (email, created_at);
-- Avisos de vencimento já enviados
CREATE TABLE IF NOT EXISTS notice_log (
  store_id TEXT NOT NULL,
  kind     TEXT NOT NULL,
  ref      INTEGER NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (store_id, kind, ref)
);
