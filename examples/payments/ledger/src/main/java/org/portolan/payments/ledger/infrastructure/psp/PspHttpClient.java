package org.portolan.payments.ledger.infrastructure.psp;

/** The HTTP the gateway is spoken to with. Nothing above infrastructure sees it. */
public interface PspHttpClient {

    String post(String path, String body);

    String delete(String path);
}
