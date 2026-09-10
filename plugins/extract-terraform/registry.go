package extractterraform

import "strings"

// A registry module the reader knows is read as the resource it wraps: its
// inputs are the resource's attributes under the module's names, and its
// outputs are references to it. terraform-aws-modules spells a queue's
// ARN `queue_arn` in one major version and `sqs_queue_arn` in the last, so
// both are listed; a version pin is not read, the inputs are.

type knownModule struct {
	// kind is the aws_* type the module stands for.
	kind string
	// inputs maps a resource attribute or nested block name to the module
	// input that carries it, where the two differ.
	inputs map[string]string
	// outputs maps a module output to the attribute of the resource it is
	// worth: "arn", "url", "stream_arn", "function_name", "id". An output
	// that is another resource the module makes - the dead-letter queue
	// beside the queue - is spelled "<derived>:<attribute>".
	outputs map[string]string
}

var registry = map[string]*knownModule{
	"terraform-aws-modules/lambda/aws": {
		kind: typeFunction,
		inputs: map[string]string{
			"environment": "environment_variables",
		},
		outputs: map[string]string{
			"lambda_function_arn":           "arn",
			"lambda_function_invoke_arn":    "invoke_arn",
			"lambda_function_name":          "function_name",
			"lambda_function_qualified_arn": "qualified_arn",
		},
	},
	"terraform-aws-modules/sqs/aws": {
		kind: typeQueue,
		outputs: map[string]string{
			"queue_arn":             "arn",
			"queue_url":             "url",
			"queue_id":              "id",
			"queue_name":            "name",
			"sqs_queue_arn":         "arn",
			"sqs_queue_id":          "url",
			"sqs_queue_name":        "name",
			"dead_letter_queue_arn": "dlq:arn",
			"dead_letter_queue_url": "dlq:url",
			"dead_letter_queue_id":  "dlq:id",
		},
	},
	"terraform-aws-modules/sns/aws": {
		kind: typeTopic,
		outputs: map[string]string{
			"topic_arn":  "arn",
			"topic_id":   "id",
			"topic_name": "name",
		},
	},
	"terraform-aws-modules/s3-bucket/aws": {
		kind: typeBucket,
		outputs: map[string]string{
			"s3_bucket_arn":         "arn",
			"s3_bucket_id":          "id",
			"s3_bucket_bucket_name": "bucket",
		},
	},
	"terraform-aws-modules/s3-bucket/aws//modules/notification": {
		kind: typeNotification,
		inputs: map[string]string{
			"lambda_function":     "lambda_notifications",
			"lambda_function_arn": "function_arn",
			"queue":               "sqs_notifications",
			"topic":               "sns_notifications",
		},
	},
	"terraform-aws-modules/dynamodb-table/aws": {
		kind: typeTable,
		inputs: map[string]string{
			"attribute":              "attributes",
			"global_secondary_index": "global_secondary_indexes",
			"local_secondary_index":  "local_secondary_indexes",
		},
		outputs: map[string]string{
			"dynamodb_table_arn":        "arn",
			"dynamodb_table_id":         "id",
			"dynamodb_table_stream_arn": "stream_arn",
		},
	},
}

// knownSource is the registry module a source string names, with the source
// as the registry spells it: the public registry's host, a git URL to the
// module's repository and a ref pin all come back to
// terraform-aws-modules/<name>/aws, and a subpath after // is kept.
func knownSource(source string) (*knownModule, string) {
	normalized := normalizeSource(source)
	return registry[normalized], normalized
}

func normalizeSource(source string) string {
	source = strings.TrimPrefix(source, "git::")
	if at := strings.Index(source, "?"); at >= 0 {
		source = source[:at]
	}
	// The scheme's "://" is not the subpath separator; what follows it is.
	if scheme := strings.Index(source, "://"); scheme >= 0 {
		source = source[scheme+3:]
	}
	subpath := ""
	if sub := strings.Index(source, "//"); sub >= 0 {
		subpath = source[sub:]
		source = source[:sub]
	}
	source = strings.TrimPrefix(source, "git@")
	source = strings.Replace(source, "github.com:", "github.com/", 1)
	source = strings.TrimPrefix(source, "registry.terraform.io/")
	source = strings.TrimPrefix(source, "app.terraform.io/")
	source = strings.TrimSuffix(source, ".git")
	const mirror = "github.com/terraform-aws-modules/terraform-aws-"
	if strings.HasPrefix(source, mirror) {
		source = "terraform-aws-modules/" + source[len(mirror):] + "/aws"
	}
	return source + subpath
}
