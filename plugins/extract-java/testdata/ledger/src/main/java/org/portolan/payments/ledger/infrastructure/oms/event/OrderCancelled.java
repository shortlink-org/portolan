package org.portolan.payments.ledger.infrastructure.oms.event;

/**
 * Another service's event, as this one needs to read it. The manifest says
 * which aggregate it belongs to; without that line the policy is unresolved.
 */
public record OrderCancelled(String orderId, String reason) {

    public static final String NAME = "oms.OrderCancelled";
}
