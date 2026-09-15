# apply_coupon

Asks pricing whether a coupon is good for the basket's lines, and for how
much, then takes the discount pricing agreed to: one coupon per basket, in the
basket's currency, never more than the lines are worth. The discount is
pricing's answer (cart.0003), and the coupon is on the quote at checkout
(cart.0004).
