-- How much of each list is actually being quoted from, in one row per list.
--
-- A view rather than a counter: the number is the rows that exist, and a copy
-- of it would be a second answer to a question the tables already answer.
CREATE VIEW v_price_list_use AS
SELECT l.id        AS price_list_id,
       l.name      AS name,
       l.currency  AS currency,
       count(r.sku) AS rows_priced
  FROM price_lists l
  LEFT JOIN price_rows r ON r.price_list_id = l.id
 GROUP BY l.id;
