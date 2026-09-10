<?php

namespace Acme\Sales\Jobs;

use Acme\Sales\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Event;

/**
 * Puts the order in the search index, so the back office finds it.
 */
class IndexOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $queue = 'indexing';

    public function __construct(protected int $orderId)
    {
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $order = Order::with('items')->findOrFail($this->orderId);

        Event::dispatch('sales.order.indexed', $order);
    }
}
