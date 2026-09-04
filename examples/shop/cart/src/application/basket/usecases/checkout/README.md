# checkout

Freezes the basket and hands it on: the session is confirmed with `auth`, the
total with `pricing`, then the basket is frozen and `BasketCheckedOut` written
in the same transaction (cart.0004).
