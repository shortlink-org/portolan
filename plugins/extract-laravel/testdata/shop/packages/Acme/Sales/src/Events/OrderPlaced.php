<?php

namespace Acme\Sales\Events;

use Acme\Sales\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * The customer paid and the order is theirs to wait for.
 */
class OrderPlaced
{
    use Dispatchable;
    use SerializesModels;

    /**
     * Where the order came from, for the analytics.
     */
    public string $channel = 'web';

    public function __construct(
        public readonly Order $order,
        public int $itemCount = 0,
    ) {
    }
}
