<?php

namespace Acme\Checkout\Listeners;

use Acme\Checkout\Models\Cart;

class CartUpkeep
{
    /**
     * Drops the carts of whatever the repository deleted.
     */
    public function forget($event)
    {
        Cart::where('customer_id', $event->getModel()->id)->delete();
    }

    /**
     * Adds a delivery note under the cart's summary.
     */
    public function addNote($viewRenderEventManager)
    {
        $viewRenderEventManager->addTemplate('checkout::cart.note');
    }
}
