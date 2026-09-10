<?php

namespace App\Http\Controllers;

use App\Events\UserRegistered;
use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    /**
     * Lists the users.
     */
    public function index()
    {
        return User::all();
    }

    /**
     * Registers a user.
     */
    public function store(Request $request)
    {
        $user = User::create($request->all());

        UserRegistered::dispatch($user);

        return $user;
    }
}
