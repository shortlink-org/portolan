<?php

declare(strict_types=1);

namespace Acme\Mooc\Steps\Application\Create;

use Acme\Shared\Domain\Bus\Command\Command;

final readonly class CreateVideoStepCommand implements Command
{
	public function __construct(private string $id, private string $title, private string $url) {}

	public function id(): string
	{
		return $this->id;
	}

	public function title(): string
	{
		return $this->title;
	}

	public function url(): string
	{
		return $this->url;
	}
}
