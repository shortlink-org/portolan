<?php

namespace Acme\Sales\Models;

use Acme\Customer\Models\CustomerProxy;
use Acme\Sales\Contracts\Order as OrderContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What a customer bought, from the moment they paid.
 *
 * @property int $id
 */
class Order extends Model implements OrderContract
{
    /**
     * Placed, not yet paid.
     */
    public const STATUS_PENDING = 'pending';

    /**
     * Being picked and packed.
     */
    public const STATUS_PROCESSING = 'processing';

    public const STATUS_COMPLETED = 'completed';

    /**
     * Cancelled before it shipped.
     *
     * @deprecated orders are closed, not canceled
     */
    public const STATUS_CANCELED = 'canceled';

    public const STATUS_CLOSED = 'closed';

    public const MAX_ITEMS = 100;

    protected $table = 'orders';

    protected $fillable = [
        'status',
        'customer_id',
        'grand_total',
        'placed_at',
    ];

    protected $casts = [
        'grand_total' => 'float',
        'placed_at' => 'datetime',
    ];

    /**
     * The lines of the order.
     */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class, 'order_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(CustomerProxy::modelClass());
    }

    public function scopeOpen($query)
    {
        return $query->whereIn('status', [self::STATUS_PENDING, self::STATUS_PROCESSING]);
    }
}
