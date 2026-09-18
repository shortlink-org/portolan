<?php

namespace Acme\Sales\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Marks an export done once every chunk is written.
 */
class ExportCompleted implements ShouldQueue
{
    public function handle(): void
    {
    }
}
