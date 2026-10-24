// Package genreference is portolan-gen-reference: a catalog in, one portable
// architecture reference out.
package genreference

import (
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

// Serve answers one plugin protocol request.
func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		return render(req, opts)
	})
}
