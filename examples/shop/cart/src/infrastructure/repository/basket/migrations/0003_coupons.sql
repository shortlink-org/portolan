-- The coupon pricing accepted for a basket: one per basket, as a pair of
-- columns rather than a table, since there is never more than one.
ALTER TABLE baskets
    ADD COLUMN coupon_code text,
    ADD COLUMN coupon_discount_minor bigint;
