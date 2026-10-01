# extract-terraform

AWS, Azure Event Grid and Azure Service Bus Terraform in; the queues,
topics, functions and stores a module declares, and the subscriptions,
filters, triggers, grants and dead-letter routes that join them, out. A
module is read as syntax and never evaluated: no provider, no state, no plan
(`hcl.go`).

## What it reads

`*.tf` files in `dir`, or - left out - the input root when it holds any, else
the first directory under it that does (the rest named in a warning). Local
modules (`source = "./..."`) are followed from where they are called;
registry modules the reader knows (`registry.go`: `terraform-aws-modules`
lambda, sqs and others listed there) are read as the resource they wrap.
A value is followed to a literal, a variable's default, a local, the argument
a calling module block passed, or a child module's output; a reference from
one resource to another is an edge by itself.

Resource types (`resources.go`): `aws_sqs_queue`, `aws_sns_topic`,
`aws_sns_topic_subscription`, `aws_lambda_function`,
`aws_lambda_event_source_mapping`, `aws_s3_bucket`,
`aws_s3_bucket_notification`, `aws_dynamodb_table`, `aws_db_instance`,
`aws_rds_cluster`; Azure `azurerm_eventgrid_topic`, `_system_topic`,
`_domain`, `_domain_topic`, `_event_subscription`,
`_system_topic_event_subscription`, `azurerm_function_app_function`,
`azurerm_eventhub`, `azurerm_servicebus_namespace`, `_queue`, `_topic`,
`_subscription`, `_subscription_rule`, `azurerm_storage_queue`,
`azurerm_role_assignment`. Kinesis, EventBridge, API Gateway, Step
Functions, ElastiCache, MSK, Amazon MQ and ECS are named once as not yet
read; any other type is passed over silently.

## What it emits

A fragment with one context holding the base service `<context>.<service>`
and one service of kind `function` per Lambda or Azure function (a function
whose name slugs to `service` is the base service itself, with its
technologies). Top-level `stores` (S3 buckets, DynamoDB tables, RDS) are
owned by the base service and listed on the components that reach them.
Queues and topics are `channels` (SQS kind `message`, SNS kind `event`;
Event Grid and Service Bus destinations likewise) on every component that
touches them - through an event source mapping, an SNS subscription, an
environment variable, an S3 notification, a Service Bus binding or an Event
Grid subscription - with one sentence per fact in `doc` ("Received by `fn`
through an event source mapping.", "Dead letters go to `x` after 3
receives.", "Nothing in the module receives from it…") and the Terraform
address. Service Bus filters are read for the properties they name, never
the values; connection settings are never opened.

## Options

`context`, `service`, `dir`, `out` (`terraform.json`). See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "terraform", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "terraform", "in": "services/fulfillment", "out": "services/fulfillment/portolan",
      "options": { "context": "shop", "service": "fulfillment", "dir": "deploy/terraform" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `terraform`; or `go run ./plugins/cmd/portolan-go terraform`.

## Limits

- Which way messages go through an environment variable is not said.
- A registry module outside the known list is not read.
- A value the syntax does not reach stays unresolved, with a warning at the
  attribute.
- A file that will not parse is reported and the rest is read.

## Tests

`go test ./plugins/extract-terraform/...`, with golden fixtures under
`testdata/serverless` and `testdata/registry`, and Service Bus and Event Grid
cases inline.
