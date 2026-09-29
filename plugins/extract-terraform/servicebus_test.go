package extractterraform

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const serviceBusModule = `
resource "azurerm_servicebus_namespace" "shop" {
  name = "shop-bus"
  sku  = "Premium"
}

resource "azurerm_servicebus_queue" "orders" {
  name                              = "orders"
  namespace_id                      = azurerm_servicebus_namespace.shop.id
  partitioning_enabled              = true
  requires_session                  = true
  max_delivery_count                = 5
  forward_dead_lettered_messages_to = azurerm_servicebus_queue.poison.name
}

resource "azurerm_servicebus_queue" "poison" {
  name         = "orders-poison"
  namespace_id = azurerm_servicebus_namespace.shop.id
}

resource "azurerm_servicebus_topic" "events" {
  name                         = "order-events"
  namespace_id                 = azurerm_servicebus_namespace.shop.id
  requires_duplicate_detection = true
}

resource "azurerm_servicebus_subscription" "billing" {
  name               = "billing"
  topic_id           = azurerm_servicebus_topic.events.id
  max_delivery_count = 3
}

resource "azurerm_servicebus_subscription_rule" "placed" {
  name            = "placed-only"
  subscription_id = azurerm_servicebus_subscription.billing.id
  filter_type     = "CorrelationFilter"

  correlation_filter {
    label          = "OrderPlaced"
    correlation_id = "do-not-copy-correlation"
    properties = {
      region = "do-not-copy-region"
    }
  }
}

resource "azurerm_servicebus_subscription" "audit" {
  name       = "audit"
  topic_id   = azurerm_servicebus_topic.events.id
  forward_to = azurerm_servicebus_queue.audit.name
}

resource "azurerm_servicebus_subscription_rule" "big" {
  name            = "big-orders"
  subscription_id = azurerm_servicebus_subscription.audit.id
  filter_type     = "SqlFilter"
  sql_filter      = "user.total > 1000 AND [shop region] IN ('do-not-copy-sql', 'x''y') AND sys.Label LIKE 'Order%'"
  action          = "SET priority = 'high'"
}

resource "azurerm_servicebus_subscription" "everything" {
  name     = "everything"
  topic_id = azurerm_servicebus_topic.events.id
}

resource "azurerm_servicebus_queue" "audit" {
  name         = "orders-audit"
  namespace_id = azurerm_servicebus_namespace.shop.id
}

resource "azurerm_linux_function_app" "app" {
  name = "shop-functions"
  app_settings = {
    EVENTS_TOPIC = azurerm_servicebus_topic.events.name
    SB_CONN      = "Endpoint=sb://shop-bus.servicebus.windows.net/;SharedAccessKey=do-not-copy-key"
  }
}

resource "azurerm_function_app_function" "fulfil" {
  name            = "fulfil-order"
  function_app_id = azurerm_linux_function_app.app.id
  language        = "Python"
  config_json = jsonencode({
    bindings = [
      {
        type       = "serviceBusTrigger"
        direction  = "in"
        name       = "msg"
        queueName  = azurerm_servicebus_queue.orders.name
        connection = "SB_CONN"
      },
      {
        type       = "serviceBus"
        direction  = "out"
        name       = "events"
        topicName  = "%EVENTS_TOPIC%"
        connection = "SB_CONN"
      }
    ]
  })
}

resource "azurerm_function_app_function" "bill" {
  name            = "bill-order"
  function_app_id = azurerm_linux_function_app.app.id
  language        = "Python"
  config_json     = <<JSON
{"bindings": [{"type": "serviceBusTrigger", "direction": "in", "name": "msg",
  "topicName": "order-events", "subscriptionName": "billing", "connection": "SB_CONN"}]}
JSON
}

resource "azurerm_function_app_function" "archive" {
  name            = "archive-order"
  function_app_id = azurerm_linux_function_app.app.id
  language        = "Python"
  config_json = jsonencode({
    bindings = [{ type = "serviceBusTrigger", direction = "in", name = "msg", queueName = "orders-audit", connection = "SB_CONN" }]
  })
}

resource "azurerm_role_assignment" "send" {
  scope                = azurerm_servicebus_topic.events.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_linux_function_app.app.identity[0].principal_id
}

resource "azurerm_role_assignment" "read" {
  scope              = azurerm_servicebus_namespace.shop.id
  role_definition_id = "/providers/Microsoft.Authorization/roleDefinitions/4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0"
  principal_id       = var.reader_principal
}

resource "azurerm_role_assignment" "unrelated" {
  scope                = azurerm_servicebus_namespace.shop.id
  role_definition_name = "Reader"
  principal_id         = "00000000-0000-0000-0000-000000000000"
}
`

func TestServiceBusQueuesTopicsSubscriptionsAndBindings(t *testing.T) {
	root := t.TempDir()
	write(t, root, "bus.tf", serviceBusModule)
	out, resp := extracted(t, root, Options{})
	if got := warnings(resp); len(got) != 0 {
		t.Fatalf("warnings: %v", got)
	}

	fulfil := service(t, out, "shop.fulfil-order")
	orders := channel(t, fulfil, "orders")
	if orders.Title != "Azure Service Bus queue" || orders.Kind != catalog.ChannelKindMessage || orders.Source != "bus.tf:7" {
		t.Errorf("orders: %+v", orders)
	}
	for _, want := range []string{
		"Declared in Terraform as azurerm_servicebus_queue.orders. In namespace `shop-bus` (Premium). Partitioned. Sessions required.",
		"Dead-lettered after 5 deliveries.",
		"Dead letters are forwarded to `orders-poison`.",
		"Received by `fulfil-order` through a Service Bus trigger.",
	} {
		if !strings.Contains(orders.Doc, want) {
			t.Errorf("orders doc lacks %q:\n%s", want, orders.Doc)
		}
	}
	sent := channel(t, fulfil, "order-events")
	if sent.Kind != catalog.ChannelKindEvent || !strings.Contains(sent.Doc, "Sent by `fulfil-order` through a Service Bus output binding.") {
		t.Errorf("output binding through an app setting: %+v", sent)
	}

	events := channel(t, service(t, out, "shop.bill-order"), "order-events")
	for _, want := range []string{
		"Duplicate detection on.",
		"Received by `bill-order` through subscription `billing`.",
		"Subscription `billing` filters with rule `placed-only`, a correlation filter on label `OrderPlaced` and `correlation_id`, `region`. Dead-lettered after 3 deliveries.",
		"Subscription `audit` filters with rule `big-orders`, a SQL filter on `user.total`, `shop region`, `sys.Label`, with a SQL action that rewrites what passes. Forwards to `orders-audit`.",
		"Subscription `everything` takes every message; no rule is declared here.",
		"`Azure Service Bus Data Sender` granted to `azurerm_linux_function_app.app`.",
		"`Azure Service Bus Data Receiver` granted to `var.reader_principal` on the whole namespace `shop-bus`.",
	} {
		if !strings.Contains(events.Doc, want) {
			t.Errorf("order-events doc lacks %q:\n%s", want, events.Doc)
		}
	}

	archive := service(t, out, "shop.archive-order")
	if got := channel(t, archive, "order-events"); !strings.Contains(got.Doc, "Received by `archive-order` through subscription `audit`, forwarded to `orders-audit`.") {
		t.Errorf("topic read through a forwarded queue: %s", got.Doc)
	}
	if got := channel(t, archive, "orders-audit"); !strings.Contains(got.Doc, "Filled by subscription `audit` of topic `order-events`.") {
		t.Errorf("forward target: %s", got.Doc)
	}

	poison := channel(t, service(t, out, "shop.fulfillment"), "orders-poison")
	if !strings.Contains(poison.Doc, "Takes the dead letters of `orders`.") || !strings.Contains(poison.Doc, "Nothing in the module receives from it.") {
		t.Errorf("poison queue on the base service: %s", poison.Doc)
	}
}

func TestServiceBusKeepsValuesOut(t *testing.T) {
	root := t.TempDir()
	write(t, root, "bus.tf", serviceBusModule+`
resource "azurerm_function_app_function" "leak" {
  name            = "leak"
  function_app_id = azurerm_linux_function_app.app.id
  config_json = jsonencode({
    bindings = [{ type = "serviceBusTrigger", queueName = "%SB_CONN%", connection = "SB_CONN" }]
  })
}
`)
	_, resp := extracted(t, root, Options{})
	got := warnings(resp)
	if len(got) != 1 || !strings.HasSuffix(got[0], "queueName of azurerm_function_app_function.leak is app setting `SB_CONN`, which does not name a Service Bus queue or topic declared here, so the binding is not read") {
		t.Errorf("warnings: %v", got)
	}
	text := resp.Files[0].Contents + strings.Join(got, "\n")
	for _, planted := range []string{"do-not-copy", "SharedAccessKey", "x''y", "high", "00000000-"} {
		if strings.Contains(text, planted) {
			t.Errorf("%q reached the fragment or the warnings", planted)
		}
	}
}

func TestServiceBusBindingNamesTheModuleDoesNotDeclare(t *testing.T) {
	root := t.TempDir()
	write(t, root, "main.tf", `
resource "azurerm_function_app_function" "ship" {
  name            = "ship-order"
  function_app_id = azurerm_linux_function_app.app.id
  config_json = jsonencode({
    bindings = [
      { type = "serviceBusTrigger", queueName = "shipments" },
      { type = "serviceBus", direction = "out", queueName = "shipped-%ENV%" },
    ]
  })
}
`)
	out, resp := extracted(t, root, Options{})
	got := warnings(resp)
	if len(got) != 1 || !strings.HasSuffix(got[0], "queueName of azurerm_function_app_function.ship is `shipped-{ENV}`, with app settings ENV decided at deployment") {
		t.Errorf("warnings: %v", got)
	}
	ship := service(t, out, "shop.ship-order")
	shipments := channel(t, ship, "shipments")
	if shipments.Doc != "Named by a Service Bus binding of azurerm_function_app_function.ship; not declared in this module. Received by `ship-order` through a Service Bus trigger." || shipments.Source != "main.tf:2" {
		t.Errorf("undeclared queue: %+v", shipments)
	}
	if shipped := channel(t, ship, "shipped-{ENV}"); !strings.Contains(shipped.Doc, "Sent by `ship-order` through a Service Bus output binding.") {
		t.Errorf("shaped name: %+v", shipped)
	}
}

func TestServiceBusSubscriptionOfAnUndeclaredTopicIsSaid(t *testing.T) {
	root := t.TempDir()
	write(t, root, "main.tf", `
resource "azurerm_servicebus_subscription" "billing" {
  name     = "billing"
  topic_id = var.topic_id
}
`)
	_, resp := extracted(t, root, Options{})
	got := warnings(resp)
	if len(got) != 2 || !strings.HasSuffix(got[1], "topic_id of azurerm_servicebus_subscription.billing could not be followed to a Service Bus topic declared here, so the subscription is not read") {
		t.Errorf("warnings: %v", got)
	}
}
