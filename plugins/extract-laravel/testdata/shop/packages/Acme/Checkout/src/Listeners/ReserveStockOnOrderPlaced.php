<?php

namespace Acme\Checkout\Listeners;

use Acme\Sales\Events\OrderPlaced;
use Illuminate\Support\Facades\Event;

class ReserveStockOnOrderPlaced
{
    /**
     * Takes the ordered quantities out of what is available to sell.
     */
    public function handle(OrderPlaced $event): void
    {
        foreach ($event->order->items as $item) {
            Event::dispatch('inventory.stock.reserved', $item);
        }
    }
}
