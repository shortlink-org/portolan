<?php

namespace Acme\Checkout\Http\Controllers;

use Acme\Checkout\Facades\Cart;
use Acme\Sales\Repositories\OrderRepository;

class OnepageController extends Controller
{
    public function __construct(
        protected OrderRepository $orderRepository,
    ) {
    }

    /**
     * The one page the whole checkout happens on.
     */
    public function index()
    {
        return view('shop::checkout.onepage.index');
    }

    /**
     * Places the order for the cart.
     */
    public function storeOrder()
    {
        $data = (new OrderResource(Cart::getCart()))->jsonSerialize();

        $order = $this->orderRepository->create($data);

        Cart::deActivateCart();

        return response()->json(['redirect_url' => route('shop.checkout.onepage.success', ['order' => $order])]);
    }

    /**
     * Thanks the customer.
     */
    public function success()
    {
        return view('shop::checkout.success');
    }
}
