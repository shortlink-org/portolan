<?php

declare(strict_types=1);

namespace Acme\Mooc\Videos\Application\Trim;

/** Named like a handler, registered as none: the bus never reaches it. */
final readonly class TrimVideoCommandHandler
{
	public function __invoke(TrimVideoCommand $command): void {}
}
