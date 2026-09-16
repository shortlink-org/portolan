package org.portolan.payments.ledger.domain.payment.vo;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Size;

import org.jmolecules.ddd.annotation.ValueObject;

/** What the payer told us about themselves when the payment was made. */
@ValueObject
public record Reference(
        @NotBlank @Size(max = 64) String statementText,
        @Email String payerEmail,
        @NotNull @Past Instant takenAt,
        @Size(max = 4) List<@NotBlank @Size(max = 16) String> tags,
        @Size(max = 8) Map<@NotBlank String, @Size(max = 32) String> metadata) {}
