package gendx

import (
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		return render(req, opts)
	})
}
