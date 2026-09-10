<?php

namespace Acme\Checkout\Models;

use Acme\Customer\Models\CustomerProxy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What a customer is about to buy.
 */
class Cart extends Model
{
    protected $fillable = ['customer_id', 'is_guest', 'items_count'];

    protected $casts = [
        'is_guest' => 'boolean',
        'items_count' => 'integer',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(CartItem::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(CustomerProxy::modelClass());
    }
}
