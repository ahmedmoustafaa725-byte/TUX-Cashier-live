import { __test_extractPaymentPartsFromSource as extractPaymentParts } from "./App";

describe("extractPaymentPartsFromSource", () => {
  it("does not inflate partial customer payments", () => {
    const parts = extractPaymentParts(
      {
        cashToPay: "50",
      },
      95,
      "Cash"
    );

    expect(parts).toEqual([{ method: "Cash", amount: 50 }]);
  });
});
