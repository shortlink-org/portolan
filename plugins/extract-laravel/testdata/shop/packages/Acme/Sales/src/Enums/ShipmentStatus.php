<?php

namespace Acme\Sales\Enums;

/**
 * Where a shipment is on its way to the customer.
 */
enum ShipmentStatus: string
{
    case Packed = 'packed';

    /**
     * Handed to the carrier.
     */
    case Shipped = 'shipped';

    case Delivered = 'delivered';
}
