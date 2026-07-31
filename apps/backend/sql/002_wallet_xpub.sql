-- Wallets are derived from a single watch-only account xpub held in app_settings.
-- Users never hold a seed phrase: the signing seed lives offline in a cold wallet
-- that is never connected to this service. Addresses are identifiers only —
-- Candy balances live in the `balances` table and every authorization is checked
-- against the user's session, never against a wallet signature.
CREATE SEQUENCE IF NOT EXISTS wallet_address_index_seq
  AS INTEGER
  START WITH 0
  MINVALUE 0
  MAXVALUE 2147483647
  INCREMENT BY 1
  NO CYCLE;

-- Keep the sequence ahead of any address index already handed out, so an existing
-- database never re-issues an index after this migration.
SELECT setval(
  'wallet_address_index_seq',
  COALESCE((SELECT MAX(address_index) + 1 FROM users), 0),
  false
);
