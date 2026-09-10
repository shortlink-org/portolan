<?php

namespace Acme\Sales\Repositories;

use Acme\Sales\Contracts\Order as OrderContract;
use Acme\Sales\Events\OrderPlaced;
use Acme\Sales\Jobs\IndexOrder;
use Acme\Sales\Models\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

class OrderRepository
{
    /**
     * Specify the model class name.
     */
    public function model(): string
    {
        return OrderContract::class;
    }

    /**
     * Turns a checked-out cart into an order, all or nothing.
     */
    public function create(array $data): Order
    {
        DB::beginTransaction();

        try {
            Event::dispatch('checkout.order.save.before', [$data]);

            $order = $this->model->create($data);

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

        IndexOrder::dispatch($order->id);

        return $order;
    }

    /**
     * Cancels an order that has not shipped.
     */
    public function cancel(int $id): bool
    {
        $order = Order::findOrFail($id);

        Event::dispatch('sales.order.cancel.before', $order);

        Order::where('id', $id)->update(['status' => Order::STATUS_CANCELED]);

        Event::dispatch('sales.order.cancel.after', $order);

        return true;
    }
}
