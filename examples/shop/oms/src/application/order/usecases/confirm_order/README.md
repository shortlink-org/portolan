# Confirm order

Confirms a placed order once its total is authorised with payments, and says
so with `OrderConfirmed`. Payments is asked synchronously, because the answer
is what decides; no service in the estate provides `payments.v1` yet, so the
call is a stand-in until one does (ADR oms.0005).
