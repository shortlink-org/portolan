<?php

namespace Acme\Checkout\Http\Controllers;

use Acme\Checkout\Facades\Cart;
use Acme\Checkout\Jobs\SendCartReminder;
use Illuminate\Http\Request;

class CartController extends Controller
{
    /**
     * Shows the cart.
     */
    public function index()
    {
        return view('shop::checkout.cart.index');
    }

    /**
     * Puts a product in the cart.
     *
     * The quantity comes from the request and is clamped to what is in stock.
     */
    public function store(Request $request, int $id)
    {
        $cart = Cart::addProduct($id, $request->all());

        event('checkout.cart.add.after', $cart);

        dispatch(new SendCartReminder($cart))->onQueue('mail')->delay(now()->addHours(24));

        return redirect()->back();
    }

    public function destroy(int $id)
    {
        Cart::removeItem($id);

        Event::dispatch('checkout.cart.item.delete.after', $id);

        return redirect()->back();
    }
}
