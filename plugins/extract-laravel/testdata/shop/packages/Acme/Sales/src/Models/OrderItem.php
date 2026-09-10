<?php

namespace Acme\Sales\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One product on an order, at the price it was bought for.
 */
class OrderItem extends Model
{
    protected $fillable = ['order_id', 'sku', 'qty_ordered', 'price'];

    protected $casts = [
        'qty_ordered' => 'integer',
        'price' => 'float',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
