<x-shop::layouts>
    {!! view_render_event('shop.checkout.cart.summary.before', ['cart' => $cart]) !!}

    <div class="summary">{{ $cart->grand_total }}</div>

    {!! view_render_event('shop.checkout.cart.summary.after', ['cart' => $cart]) !!}
</x-shop::layouts>
