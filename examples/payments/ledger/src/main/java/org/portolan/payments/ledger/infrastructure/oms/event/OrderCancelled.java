package org.portolan.payments.ledger.infrastructure.oms.event;

/**
 * Another service's event, in the shape this one needs to read it.
 *
 * The manifest says which aggregate it belongs to; without that line the policy
 * that listens for it names a type and resolves to nothing.
 */
public record OrderCancelled(String orderId, String reason) {

    public static final String NAME = "oms.OrderCancelled";
}
