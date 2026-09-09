//! Readable checks over the committed service tree. These keep a golden
//! failure from being the first and only explanation of a broken extractor.

mod common;

#[test]
fn reads_the_service_and_its_domain_from_the_layout() {
    let fragment = common::fragment();
    let service = &fragment["contexts"][0]["services"][0];

    assert_eq!(service["id"], "shop.oms");
    assert_eq!(service["name"], "Order Management");
    assert_eq!(service["repo"], "github.com/acme/shop");

    let order = &service["aggregates"][0];
    assert_eq!(order["id"], "shop.oms.order");
    assert_eq!(order["root"], "Order");
    assert_eq!(names(&order["operations"]), ["CancelOrder", "ConfirmOrder", "GetOrder", "PlaceOrder"]);
    assert_eq!(names(&order["events"]), ["OrderCancelled", "OrderConfirmed", "OrderPlaced"]);
}

#[test]
fn joins_clients_policies_and_use_cases_across_the_tree() {
    let fragment = common::fragment();
    let service = &fragment["contexts"][0]["services"][0];
    let call = &service["consumes"][0];
    assert_eq!(call["id"], "payments.v1.PaymentService/Authorize");
    assert_eq!(call["peer"], "payments.ledger");

    let flows = fragment["flows"].as_array().expect("flows is an array");
    let slugs: Vec<_> = flows.iter().map(|flow| flow["slug"].as_str().unwrap()).collect();
    assert_eq!(
        slugs,
        [
            "oms-cancel-order",
            "oms-get-order",
            "oms-confirm-order-on-payment-authorized",
            "oms-place-order-on-basket-checked-out",
        ]
    );
}

fn names(value: &serde_json::Value) -> Vec<&str> {
    value
        .as_array()
        .expect("catalog collection is an array")
        .iter()
        .map(|item| item["name"].as_str().or_else(|| item["id"].as_str()).unwrap())
        .collect()
}
