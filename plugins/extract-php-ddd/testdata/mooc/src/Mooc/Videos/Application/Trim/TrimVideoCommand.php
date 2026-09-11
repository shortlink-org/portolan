<?php

declare(strict_types=1);

namespace Acme\Mooc\Videos\Application\Trim;

use Acme\Shared\Domain\Bus\Command\Command;

final readonly class TrimVideoCommand implements Command
{
	public function __construct(private string $videoId, private int $keepFromSecond, private int $keepToSecond) {}
}
