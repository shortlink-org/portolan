//! Readable checks over the committed application tree. These keep a golden
//! failure from being the first and only explanation of a broken extractor.

mod common;

#[test]
fn reads_the_application_and_its_modules() {
    let fragment = common::fragment();
    let service = &fragment["contexts"][0]["services"][0];

    assert_eq!(service["id"], "shop.shop");
    assert_eq!(service["name"], "Acme Shop");
    assert_eq!(service["repo"], "github.com/acme/shop");

    let groups: Vec<&str> = service["aggregates"].as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(groups, ["shop.shop.models-checkout", "shop.shop.models-customer", "shop.shop.models-sales"]);
    for group in service["aggregates"].as_array().unwrap() {
        assert_eq!(group["kind"], "model-group");
        assert_eq!(group["root"], "");
    }
}

#[test]
fn reads_eloquent_models_with_their_casts_columns_relations_and_enums() {
    let fragment = common::fragment();
    let sales = &fragment["contexts"][0]["services"][0]["aggregates"][2];
    let order = &sales["entities"][0];
    assert_eq!(order["name"], "Order");
    assert_eq!(order["doc"], "What a customer bought, from the moment they paid.");
    let fields: Vec<String> = order["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| format!("{}:{}", f["name"].as_str().unwrap(), f["type"].as_str().unwrap()))
        .collect();
    assert_eq!(
        fields,
        [
            "id:int",
            "grand_total:float",
            "placed_at:datetime",
            "status:mixed",
            "customer_id:mixed",
            "created_at:datetime",
            "updated_at:datetime",
            "items:HasMany[OrderItem]",
            "customer:BelongsTo[Customer]"
        ]
    );

    let enums: Vec<&str> = sales["enums"].as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
    assert_eq!(enums, ["shop.shop.models-sales.shipment-status", "shop.shop.models-sales.order-status"]);
    let status = &sales["enums"][1];
    let values: Vec<&str> = status["values"].as_array().unwrap().iter().map(|v| v["name"].as_str().unwrap()).collect();
    assert_eq!(values, ["pending", "processing", "completed", "canceled", "closed"]);
    assert_eq!(status["values"][3]["deprecated"], true);
    assert_eq!(status["values"][0]["doc"], "Placed, not yet paid.");
}

#[test]
fn declares_class_events_with_payloads_and_named_events_without() {
    let fragment = common::fragment();
    let sales = &fragment["contexts"][0]["services"][0]["aggregates"][2];
    let names: Vec<&str> = sales["events"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["OrderPlaced", "SalesOrderCancelBefore", "SalesOrderCancelAfter"]);

    let placed = &sales["events"][0];
    assert_eq!(placed["wire"]["name"], "Acme\\Sales\\Events\\OrderPlaced");
    assert_eq!(placed["versions"][0]["doc"], "The customer paid and the order is theirs to wait for.");
    let fields: Vec<&str> = placed["versions"][0]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["order", "itemCount", "channel"]);
    assert_eq!(placed["consumers"][0]["note"], "ReserveStockOnOrderPlaced::handle");

    // Dispatched from Sales, named for Checkout: the checkout group owns it.
    let checkout = &fragment["contexts"][0]["services"][0]["aggregates"][0];
    let names: Vec<&str> = checkout["events"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"CheckoutOrderSaveAfter"), "{names:?}");
    let cancel = &sales["events"][2];
    assert_eq!(cancel["wire"]["name"], "sales.order.cancel.after");
    assert_eq!(cancel["versions"][0]["fields"].as_array().unwrap().len(), 0);
    assert_eq!(cancel["consumers"][0]["note"], "ReleaseStock::onOrderCanceled");
}

#[test]
fn infers_the_http_contract_from_the_route_files() {
    let fragment = common::fragment();
    let service = &fragment["contexts"][0]["services"][0];
    let ids: Vec<&str> = service["provides"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["shop.shop.checkout", "shop.shop.customer"]);
    let checkout = &service["provides"][0];
    assert_eq!(checkout["source"], "testdata/shop/portolan/openapi.inferred.yaml");
    let methods: Vec<String> = checkout["methods"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            format!(
                "{} {} {}",
                m["name"].as_str().unwrap(),
                m["http"]["method"].as_str().unwrap(),
                m["http"]["path"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(
        methods,
        [
            "shop_checkout_cart_index GET /checkout/cart",
            "shop_checkout_cart_remove DELETE /checkout/cart/remove/{id}",
            "shop_checkout_cart_store POST /checkout/cart/add/{id}",
            "shop_checkout_onepage_index GET /checkout/onepage",
            "shop_checkout_onepage_orders_store POST /checkout/onepage/orders",
            "shop_checkout_onepage_success GET /checkout/onepage/success",
        ]
    );
    assert_eq!(checkout["methods"][2]["doc"], "Puts a product in the cart.");

    let yaml = common::openapi();
    assert!(yaml.contains("operationId: shop_checkout_cart_store"));
    assert!(
        yaml.contains("x-portolan-verb: any"),
        "a route answering every verb is a path item with no operation"
    );
    assert!(yaml.contains("x-portolan-route: shop.customer.session.create"));
}

#[test]
fn follows_a_request_into_what_it_publishes_and_a_listener_out_of_what_it_reacts_to() {
    let fragment = common::fragment();
    let flows = fragment["flows"].as_array().unwrap();
    let flow = |slug: &str| flows.iter().find(|f| f["slug"] == slug).unwrap_or_else(|| panic!("no flow {slug}"));
    let steps = |f: &serde_json::Value| {
        f["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                format!(
                    "{} {} {}",
                    s["kind"].as_str().unwrap(),
                    s["label"].as_str().unwrap(),
                    s["status"].as_str().unwrap()
                )
            })
            .collect::<Vec<_>>()
    };

    // The controller calls the repository it was handed; the events are the repository's.
    let place = flow("shop-shop-checkout-onepage-orders-store");
    assert_eq!(place["summary"], "Places the order for the cart.");
    assert_eq!(
        steps(place),
        [
            "rpc shop_checkout_onepage_orders_store declared",
            "event CheckoutOrderSaveBefore declared",
            "event CheckoutOrderOrderitemSaveBefore declared",
            "event OrderPlaced declared",
            "event CheckoutOrderSaveAfter declared",
        ]
    );
    assert_eq!(place["steps"][3]["ref"], "shop.shop.models-sales.OrderPlaced");
    assert_eq!(
        place["steps"][3]["line"],
        "testdata/shop/packages/Acme/Sales/src/Repositories/OrderRepository.php:29"
    );

    let reserve = flow("shop-reserve-stock-on-order-placed-handle");
    assert_eq!(reserve["name"], "Reserve stock on order placed");
    assert_eq!(steps(reserve), ["event OrderPlaced declared", "event InventoryStockReserved declared"]);
    assert_eq!(reserve["participants"][0]["id"], "bus");

    let login = flow("shop-customer-events-handler-on-customer-login");
    assert_eq!(steps(login), ["event CustomerAfterLogin declared"]);
    assert_eq!(login["steps"][0]["ref"], "shop.shop.models-customer.CustomerAfterLogin");

    // A route answering every verb draws no flow.
    assert!(flows.iter().all(|f| f["slug"] != "shop-shop-customer"));
}

#[test]
fn reports_what_it_could_not_read_instead_of_guessing() {
    let cwd = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/shop"},"options":{"context":"shop","service":"shop"}}"#;
    let response = portolan_extract_laravel::extract::extract(
        &serde_json::from_str::<portolan_extract_laravel::protocol::Request>(request).unwrap().input,
        &serde_json::from_value(serde_json::json!({"context":"shop","service":"shop"})).unwrap(),
        cwd,
    );
    let messages: Vec<String> = response.warnings.iter().map(|w| format!("{}: {}", w.reference, w.message)).collect();
    assert!(
        messages.iter().any(|m| m.contains("Legacy/Broken.php") && m.contains("syntax error")),
        "{messages:?}"
    );
    assert!(
        messages.iter().any(|m| m.contains("AddressController") && m.contains("not in the tree")),
        "{messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|m| m.starts_with("shop.shop.models-sales:") && m.contains("dispatched by name")),
        "{messages:?}"
    );
    assert_eq!(messages.len(), 5, "{messages:?}");
}
