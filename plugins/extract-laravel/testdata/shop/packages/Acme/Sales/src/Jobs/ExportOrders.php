<?php

namespace Acme\Sales\Jobs;

use Illuminate\Bus\Batchable;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Writes one chunk of orders to the export file.
 */
class ExportOrders implements ShouldQueue
{
    use Batchable;

    public function __construct(protected array $ids)
    {
    }

    public function handle(): void
    {
    }
}
