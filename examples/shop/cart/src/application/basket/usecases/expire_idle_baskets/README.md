# expire_idle_baskets

The sweep (cart.0006): marks every open basket untouched for a day as
abandoned and publishes `BasketAbandoned` for each. Nothing calls it from
outside; the service runs it once a minute.
