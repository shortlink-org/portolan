package org.portolan.payments.ledger.infrastructure.repository.refund;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** The refund as a row. */
@Entity
@Table(name = "refunds")
public class RefundEntity {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "payment_id", nullable = false)
    private String paymentId;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    // char(3) in the table: a currency code is exactly three letters, and the
    // validator wants to hear CHAR from this side too.
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "settled_at")
    private java.time.Instant settledAt;

    protected RefundEntity() {}

    public RefundEntity(String id, String paymentId, String orderId, long amountMinor, String currency, String reason, String status, java.time.Instant settledAt) {
        this.id = id;
        this.paymentId = paymentId;
        this.orderId = orderId;
        this.amountMinor = amountMinor;
        this.currency = currency;
        this.reason = reason;
        this.status = status;
        this.settledAt = settledAt;
    }

    public String id() {
        return id;
    }

    public String paymentId() {
        return paymentId;
    }

    public String orderId() {
        return orderId;
    }

    public long amountMinor() {
        return amountMinor;
    }

    public String currency() {
        return currency;
    }

    public String reason() {
        return reason;
    }

    public String status() {
        return status;
    }

    public java.time.Instant settledAt() {
        return settledAt;
    }
}
