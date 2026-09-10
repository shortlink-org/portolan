<?php

namespace Acme\Customer\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

/**
 * Somebody who can log in and buy.
 */
class Customer extends Authenticatable
{
    protected $fillable = ['first_name', 'last_name', 'email', 'password', 'status'];

    protected $hidden = ['password'];

    protected $casts = [
        'status' => 'boolean',
        'date_of_birth' => 'date',
    ];
}
