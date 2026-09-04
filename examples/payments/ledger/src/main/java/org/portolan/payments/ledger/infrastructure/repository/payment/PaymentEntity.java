package org.portolan.payments.ledger.infrastructure.repository.payment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * The payment as a row.
 *
 * Kept apart from the domain's Payment on purpose: this one has the shape the
 * database wants - flat, nullable where the schema says so - and the mapping
 * between the two is the only place that knows both.
 */
@Entity
@Table(name = "payments")
public class PaymentEntity {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "attempt", nullable = false)
    private int attempt;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "auth_code")
    private String authCode;

    @Column(name = "created_at", nullable = false)
    private java.time.Instant createdAt;

    protected PaymentEntity() {}

    public PaymentEntity(String id, String orderId, int attempt, long amountMinor, String currency, String status, String authCode, java.time.Instant createdAt) {
        this.id = id;
        this.orderId = orderId;
        this.attempt = attempt;
        this.amountMinor = amountMinor;
        this.currency = currency;
        this.status = status;
        this.authCode = authCode;
        this.createdAt = createdAt;
    }

    public String id() {
        return id;
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

    public String status() {
        return status;
    }

    public String authCode() {
        return authCode;
    }

    public int attempt() {
        return attempt;
    }

    public java.time.Instant createdAt() {
        return createdAt;
    }
}
