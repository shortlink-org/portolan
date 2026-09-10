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
