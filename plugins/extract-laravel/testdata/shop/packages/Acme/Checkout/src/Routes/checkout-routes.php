<?php

use Acme\Checkout\Http\Controllers\CartController;
use Acme\Checkout\Http\Controllers\OnepageController;
use Illuminate\Support\Facades\Route;

/**
 * Cart routes.
 */
Route::controller(CartController::class)->prefix('checkout/cart')->group(function () {
    Route::get('', 'index')->name('shop.checkout.cart.index');

    Route::post('add/{id}', 'store')->name('shop.checkout.cart.store');

    Route::delete('remove/{id}', 'destroy')->name('shop.checkout.cart.remove');
});

/**
 * Onepage checkout routes.
 */
Route::controller(OnepageController::class)->prefix('checkout/onepage')->group(function () {
    Route::get('', 'index')->name('shop.checkout.onepage.index');

    Route::post('orders', 'storeOrder')->name('shop.checkout.onepage.orders.store');

    Route::get('success', 'success')->name('shop.checkout.onepage.success');
});
