<?php

namespace Acme\Checkout\Jobs;

use Acme\Checkout\Models\Cart;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/**
 * Reminds a customer of what they left in the cart.
 */
class SendCartReminder implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(protected Cart $cart)
    {
    }

    public function handle(): void
    {
        $cart = Cart::find($this->cart->id);

        if ($cart && $cart->items_count > 0) {
            Mail::to($cart->customer)->send(new CartReminder($cart));
        }
    }
}
