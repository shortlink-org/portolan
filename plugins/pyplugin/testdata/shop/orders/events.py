from dataclasses import dataclass


@dataclass
class OrderPlaced:
    """An order was placed."""

    order_id: str
    total: "Money"


LIMIT: int = 3
