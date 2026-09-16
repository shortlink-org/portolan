<?php

namespace Acme\Checkout\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCartItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'sku' => 'required|string|max:64',
            'quantity' => 'required|integer|min:1|max:99',
            'currency' => ['required', 'string', 'size:3', Rule::in(['USD', 'EUR'])],
            'gift_message' => 'nullable|string|max:255',
            'options' => 'array',
            'options.*' => 'string|max:32',
        ];
    }
}
