-- What is owed and what has gone back, in one row per payment.
--
-- A view rather than a column on payments: the refunded total is the sum of
-- rows that already exist, and a copy of it would be a second answer to a
-- question the journal already answers.
CREATE VIEW v_payment_state AS
SELECT p.id           AS payment_id,
       p.order_id     AS order_id,
       p.status       AS status,
       p.amount_minor AS amount_minor,
       coalesce(sum(r.amount_minor), 0) AS refunded_minor
  FROM payments p
  LEFT JOIN refunds r ON r.payment_id = p.id AND r.status = 'ISSUED'
 GROUP BY p.id;
