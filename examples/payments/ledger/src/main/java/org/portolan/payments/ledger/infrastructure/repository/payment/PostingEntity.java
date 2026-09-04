package org.portolan.payments.ledger.infrastructure.repository.payment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** One posting as a row. Append-only: there is no setter and no update path. */
@Entity
@Table(name = "postings")
public class PostingEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "payment_id", nullable = false)
    private String paymentId;

    @Column(name = "account", nullable = false)
    private String account;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "written_at", nullable = false)
    private java.time.Instant writtenAt;

    protected PostingEntity() {}

    public PostingEntity(String paymentId, String account, long amountMinor, String currency, java.time.Instant writtenAt) {
        this.paymentId = paymentId;
        this.account = account;
        this.amountMinor = amountMinor;
        this.currency = currency;
        this.writtenAt = writtenAt;
    }

    public String account() {
        return account;
    }

    public long amountMinor() {
        return amountMinor;
    }

    public String currency() {
        return currency;
    }

    public java.time.Instant writtenAt() {
        return writtenAt;
    }
}
