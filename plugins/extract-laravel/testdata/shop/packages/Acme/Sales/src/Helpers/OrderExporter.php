<?php

namespace Acme\Sales\Helpers;

use Acme\Sales\Jobs\ExportCompleted;
use Acme\Sales\Jobs\ExportOrders;
use Illuminate\Support\Facades\Bus;

class OrderExporter
{
    /**
     * Exports the orders a chunk at a time, then says it is done.
     */
    public function export(array $chunks): void
    {
        $jobs = [];

        foreach ($chunks as $ids) {
            $jobs[] = new ExportOrders($ids);
        }

        $chain[] = Bus::batch($jobs)->allowFailures();

        $chain[] = new ExportCompleted();

        Bus::chain($chain)->dispatch();
    }
}
