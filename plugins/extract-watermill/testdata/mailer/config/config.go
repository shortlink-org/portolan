package config

type Bus struct {
	Input  string `envconfig:"MAIL_INPUT_TOPIC" default:"mail.input"`
	Output string `envconfig:"MAIL_OUTPUT_TOPIC" default:"mail.output"`
	Errors string `envconfig:"MAIL_ERROR_TOPIC" default:"mail.error"`
}
