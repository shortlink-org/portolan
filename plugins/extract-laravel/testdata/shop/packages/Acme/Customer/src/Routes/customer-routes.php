<?php

use Acme\Customer\Http\Controllers\AddressController;
use Acme\Customer\Http\Controllers\SessionController;
use Illuminate\Support\Facades\Route;

Route::group(['prefix' => 'customer', 'as' => 'shop.customer.'], function () {
    Route::post('login', [SessionController::class, 'store'])->name('session.create');

    Route::delete('logout', [SessionController::class, 'destroy'])->name('session.destroy');

    Route::resource('addresses', AddressController::class)->only(['index', 'store']);

    Route::any('legacy', function () {
        return redirect('/');
    });
});
