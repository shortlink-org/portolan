import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { PaymentService } from "./gen/payments/v1/payments_pb.ts";
import { LedgerClient } from "./client.ts";

/** A ledger answering Capture in process, the way the real one answers over the wire. */
function ledger(answer: (paymentId: string) => string) {
  return new LedgerClient(
    createRouterTransport(({ service }) => {
      service(PaymentService, { capture: (request) => ({ paymentId: answer(request.paymentId) }) });
    }),
  );
}

const refuse = (code: Code) => () => {
  throw new ConnectError("refused", code);
};

describe("LedgerClient", () => {
  it("reads a capture of the payment asked about as captured", async () => {
    expect(await ledger((id) => id).capture("o-1")).toEqual({ outcome: "captured" });
  });

  it("reads the two refusals the ledger names into the port's words", async () => {
    expect(await ledger(refuse(Code.NotFound)).capture("o-1")).toEqual({ outcome: "refused", reason: "no-payment" });
    expect(await ledger(refuse(Code.FailedPrecondition)).capture("o-1")).toEqual({ outcome: "refused", reason: "not-capturable" });
  });

  it("fails on every other code: a ledger that did not answer decided nothing", async () => {
    for (const code of [Code.Unavailable, Code.Internal, Code.Aborted, Code.DeadlineExceeded]) {
      await expect(ledger(refuse(code)).capture("o-1")).rejects.toBeInstanceOf(ConnectError);
    }
  });

  it("fails on an answer for a different payment", async () => {
    await expect(ledger(() => "o-2").capture("o-1")).rejects.toThrow("the ledger answered for a different payment");
  });
});
