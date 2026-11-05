-- Nomes do plano de contas padrao com acento — a semeadura gravava "Taxas de
-- cartao", "Prestacao de servico" e os outros sem acento, e a tela mostrava
-- assim (achado do QA na tela do plano de contas).
--
-- So a conta PADRAO com o nome antigo exato muda: a que o lojista criou ou ja
-- renomeou fica como esta. E so quando o nome novo ainda nao existe na loja —
-- o indice unico e por (empresa, lower(nome)), e quem criou "Taxas de cartão"
-- a mao teria a renomeacao recusada no meio da migracao.
UPDATE ledger_accounts a
SET name = n.novo
FROM (VALUES
  ('Prestacao de servico', 'Prestação de serviço'),
  ('Taxas de cartao', 'Taxas de cartão'),
  ('Devolucoes e cancelamentos', 'Devoluções e cancelamentos'),
  ('Energia, agua e internet', 'Energia, água e internet'),
  ('Salarios e encargos', 'Salários e encargos'),
  ('Manutencao e limpeza', 'Manutenção e limpeza')
) AS n(antigo, novo)
WHERE a.is_default
  AND a.name = n.antigo
  AND NOT EXISTS (
    SELECT 1 FROM ledger_accounts b
    WHERE b.company_id = a.company_id AND lower(b.name) = lower(n.novo)
  );
