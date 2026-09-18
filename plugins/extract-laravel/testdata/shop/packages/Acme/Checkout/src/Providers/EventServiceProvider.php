<?php

namespace Acme\Checkout\Providers;

use Acme\Checkout\Listeners\ReserveStockOnOrderPlaced;
use Acme\Sales\Events\OrderPlaced;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

class EventServiceProvider extends ServiceProvider
{
    /**
     * The event listener mappings for the application.
     *
     * @var array
     */
    protected $listen = [
        OrderPlaced::class => [
            ReserveStockOnOrderPlaced::class,
        ],
        'sales.order.cancel.after' => [
            'Acme\Checkout\Listeners\ReleaseStock@onOrderCanceled',
        ],
        'Prettus\Repository\Events\RepositoryEntityDeleted' => [
            'Acme\Checkout\Listeners\CartUpkeep@forget',
        ],
        'shop.checkout.cart.summary.after' => [
            'Acme\Checkout\Listeners\CartUpkeep@addNote',
        ],
    ];

    /**
     * The subscriber classes to register.
     *
     * @var array
     */
    protected $subscribe = [
        'Acme\Checkout\Listeners\CustomerEventsHandler',
    ];
}
