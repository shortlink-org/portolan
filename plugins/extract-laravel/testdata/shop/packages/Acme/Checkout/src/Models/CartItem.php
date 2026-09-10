<?php

namespace Acme\Checkout\Models;

use Illuminate\Database\Eloquent\Model;

class CartItem extends Model
{
    protected $fillable = ['cart_id', 'sku', 'quantity'];
}
