"""Small application helpers used by HTTP handlers."""

from . import services


def issue_invoice(order_id, lines, number, now):
    """Keep transport shaping outside the domain-facing service function."""
    return services.issue_invoice(order_id, lines, number, now)
