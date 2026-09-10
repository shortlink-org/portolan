<?php

namespace Acme\Sales\Repositories;

use Acme\Sales\Events\OrderPlaced;
use Acme\Sales\Models\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

class OrderRepository
{
    /**
     * Turns a checked-out cart into an order, all or nothing.
     */
    public function create(array $data): Order
    {
        DB::beginTransaction();

        try {
            Event::dispatch('checkout.order.save.before', [$data]);

            $order = Order::create($data);

            foreach ($data['items'] as $item) {
                Event::dispatch('checkout.order.orderitem.save.before', $item);
                $order->items()->create($item);
            }

            OrderPlaced::dispatch($order, count($data['items']));

            Event::dispatch('checkout.order.save.after', $order);
        } catch (\Exception $e) {
            DB::rollBack();

            throw $e;
        }

        DB::commit();

        return $order;
    }

    /**
     * Cancels an order that has not shipped.
     */
    public function cancel(Order $order): bool
    {
        Event::dispatch('sales.order.cancel.before', $order);

        $order->status = Order::STATUS_CANCELED;
        $order->save();

        Event::dispatch('sales.order.cancel.after', $order);

        return true;
    }
}
