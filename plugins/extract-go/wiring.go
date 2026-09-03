package main

import (
	"go/ast"
	"go/types"
	"strings"
)

// portBindings reads internal/di/provider for the one thing a use case cannot
// say about itself: which other use case fills a port it declares.
//
// A use case states its need as an interface of its own - login.Authenticator -
// precisely so that it does not import the package that satisfies it. The
// binding therefore exists nowhere in either of them; it exists in assembly,
// as a provider whose result is the port and whose parameter is the use case:
//
//	func ProvideAuthenticator(uc *authenticate.UseCase) login.Authenticator
//
// Result and parameter are both written in the signature, so this reads the
// declaration and never the body. A provider that builds its port out of
// something else is not a binding between use cases and does not appear here.
func portBindings(root string) map[string]string {
	out := map[string]string{}

	pkg, err := parsePkg(root, "internal/di/provider")
	if err != nil {
		return out
	}

	for _, file := range pkg.files {
		useCases := useCaseImports(file)
		if len(useCases) == 0 {
			continue
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Type.Results == nil {
				continue
			}
			if len(fn.Type.Results.List) != 1 {
				// A provider that returns a port and an error is still a
				// provider, but two results here means the port is not the
				// whole answer and reading it as one would be a guess.
				continue
			}

			port, ok := portName(fn.Type.Results.List[0].Type, useCases)
			if !ok {
				continue
			}

			for _, param := range params(fn) {
				if useCase, ok := useCaseParam(param, useCases); ok {
					out[port] = useCase

					break
				}
			}
		}
	}

	return out
}

// portName turns the result type `login.Authenticator` into the key the use
// case's own field carries: "session/login.Authenticator". The field is written
// unqualified there - it is declared in that package - so the use case has to
// be part of the key or two ports of the same name would collide.
func portName(expr ast.Expr, useCases map[string]string) (string, bool) {
	selector, name, found := strings.Cut(types.ExprString(expr), ".")
	if !found {
		return "", false
	}

	useCase, known := useCases[selector]
	if !known {
		return "", false
	}

	return useCase + "." + name, true
}

// useCaseParam reads `*authenticate.UseCase` back to "user/authenticate".
func useCaseParam(expr ast.Expr, useCases map[string]string) (string, bool) {
	selector, name, found := strings.Cut(strings.TrimPrefix(types.ExprString(expr), "*"), ".")
	if !found || name != "UseCase" {
		return "", false
	}

	useCase, known := useCases[selector]

	return useCase, known
}

func params(fn *ast.FuncDecl) []ast.Expr {
	if fn.Type.Params == nil {
		return nil
	}

	var out []ast.Expr
	for _, param := range fn.Type.Params.List {
		out = append(out, param.Type)
	}

	return out
}
