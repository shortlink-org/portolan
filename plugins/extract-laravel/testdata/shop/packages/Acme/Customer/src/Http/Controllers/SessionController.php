<?php

namespace Acme\Customer\Http\Controllers;

use Illuminate\Support\Facades\Event;

class SessionController extends Controller
{
    /**
     * Logs the customer in.
     */
    public function store()
    {
        $customer = auth()->guard('customer')->user();

        Event::dispatch('customer.after.login', $customer);

        return redirect()->intended(route('shop.customer.profile.index'));
    }

    /**
     * Logs the customer out.
     */
    public function destroy()
    {
        auth()->guard('customer')->logout();

        Event::dispatch('customer.after.logout', request()->user());

        return redirect()->route('shop.home.index');
    }
}
