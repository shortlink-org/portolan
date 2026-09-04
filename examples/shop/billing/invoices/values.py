"""Shapes with rules and no row of their own."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Money:
    """An amount in the minor unit of a currency: 1250 GBP is £12.50."""

    amount_minor: int
    currency: str
