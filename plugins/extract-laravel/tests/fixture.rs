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
    assert_eq!(names, ["OrderPlaced", "SalesOrderIndexed", "SalesOrderCancelBefore", "SalesOrderCancelAfter"]);

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
    let cancel = &sales["events"][3];
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
            "call Order.create declared",
            "event CheckoutOrderOrderitemSaveBefore declared",
            "event OrderPlaced declared",
            "event CheckoutOrderSaveAfter declared",
            "call enqueue IndexOrder declared",
        ]
    );
    assert_eq!(place["steps"][4]["ref"], "shop.shop.models-sales.OrderPlaced");
    assert_eq!(
        place["steps"][4]["line"],
        "testdata/shop/packages/Acme/Sales/src/Repositories/OrderRepository.php:39"
    );
    // The repository's `model()` names a Concord contract; the model implementing it owns the table.
    assert_eq!(place["steps"][2]["to"], "shop-db");
    assert_eq!(place["steps"][2]["storeAccess"]["store"], "shop.shop.db");
    assert_eq!(place["steps"][6]["to"], "queue-indexing");
    assert_eq!(place["steps"][6]["handoff"]["message"], "Acme\\Sales\\Jobs\\IndexOrder");
    assert_eq!(place["steps"][6]["handoff"]["direction"], "send");
    let lanes: Vec<&str> = place["participants"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
    assert_eq!(lanes, ["client", "shop.shop", "bus", "shop-db", "queue-indexing"]);

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
fn replays_the_migrations_into_the_store_and_says_who_touches_what() {
    let stores = common::stores();
    let store = &stores["stores"][0];
    assert_eq!(store["id"], "shop.shop.db");
    assert_eq!(store["kind"], "mysql", "config/database.php names mysql as the default connection");
    assert_eq!(store["owner"], "shop.shop");
    assert_eq!(stores["contexts"][0]["services"][0]["stores"][0], "shop.shop.db");

    let names: Vec<&str> = store["tables"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        ["customers", "orders", "order_items", "carts", "cart_items"],
        "in migration order, across modules"
    );
    let orders = &store["tables"][1];
    assert_eq!(orders["persists"]["block"], "shop.shop.models-sales.order");
    let cols: Vec<String> = orders["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| format!("{}:{}", c["name"].as_str().unwrap(), c["type"].as_str().unwrap()))
        .collect();
    assert_eq!(
        cols,
        [
            "id:int unsigned",
            "increment_id:varchar(255)",
            "status:varchar(255)",
            "customer_id:bigint unsigned",
            "grand_total:decimal(12,4)",
            "placed_at:datetime",
            "created_at:timestamp",
            "updated_at:timestamp",
            "channel:varchar(32)",
        ],
        "items_count was dropped by a later migration and channel added"
    );
    assert_eq!(orders["columns"][0]["pk"], true);
    assert_eq!(orders["columns"][2]["doc"], "Where the order is on its way to the customer.");
    assert_eq!(orders["columns"][2]["maps"], "Order.status");
    assert_eq!(orders["columns"][3]["fk"]["table"], "shop.shop.db.customers");
    assert_eq!(orders["columns"][3]["fk"]["onDelete"], "set null");
    let accesses: Vec<String> = orders["accesses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| format!("{} {}", a["operation"].as_str().unwrap(), a["method"].as_str().unwrap()))
        .collect();
    assert_eq!(
        accesses,
        ["read Order.findOrFail", "write Order.create", "read Order.findOrFail", "write Order.update"]
    );
    let items = &store["tables"][2];
    assert_eq!(items["columns"][1]["fk"]["table"], "shop.shop.db.orders");
    assert_eq!(items["columns"][1]["fk"]["onDelete"], "cascade");
}

#[test]
fn puts_jobs_on_their_queues_and_works_them() {
    let fragment = common::fragment();
    let channels = fragment["contexts"][0]["services"][0]["channels"].as_array().unwrap();
    let summary: Vec<String> = channels
        .iter()
        .map(|c| {
            format!(
                "{} [{}]",
                c["address"].as_str().unwrap(),
                c["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|m| format!("{} {}", m["title"].as_str().unwrap(), m["direction"].as_str().unwrap()))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            "indexing [IndexOrder send, IndexOrder receive]",
            "mail [SendCartReminder send, SendCartReminder receive]"
        ]
    );
    assert_eq!(channels[0]["kind"], "job");
    assert_eq!(channels[0]["doc"], "Jobs queued and worked through Laravel's queue over redis.");

    let flows = fragment["flows"].as_array().unwrap();
    let worker = flows.iter().find(|f| f["slug"] == "shop-job-index-order").expect("a flow per job");
    assert_eq!(worker["name"], "Index order");
    let steps: Vec<String> = worker["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| format!("{} {}", s["kind"].as_str().unwrap(), s["label"].as_str().unwrap()))
        .collect();
    assert_eq!(steps, ["call work IndexOrder", "call Order.findOrFail", "event SalesOrderIndexed"]);
    assert_eq!(worker["steps"][0]["from"], "queue-indexing");
    assert_eq!(worker["steps"][0]["handoff"]["direction"], "receive");
    let reminder = flows.iter().find(|f| f["slug"] == "shop-job-send-cart-reminder").unwrap();
    assert_eq!(
        reminder["participants"][0]["id"], "queue-mail",
        "a job with no queue of its own is worked where it is dispatched"
    );
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
