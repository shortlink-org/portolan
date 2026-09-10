<?php

namespace Acme\Checkout\Listeners;

use Acme\Checkout\Facades\Cart;
use Illuminate\Events\Dispatcher;

class CustomerEventsHandler
{
    /**
     * Moves what a guest put in their cart over to the customer they turned out to be.
     */
    public function onCustomerLogin($customer)
    {
        Cart::mergeCart($customer);
    }

    /**
     * Register the listeners for the subscriber.
     *
     * @param  Dispatcher  $events
     * @return void
     */
    public function subscribe($events)
    {
        $events->listen('customer.after.login', 'Acme\Checkout\Listeners\CustomerEventsHandler@onCustomerLogin');
    }
}
