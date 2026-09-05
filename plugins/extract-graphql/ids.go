package main

// What a schema's parts are called in the catalog.
//
// Two readers have to agree on these. This one reads the SDL and says what a
// service provides; `extract-ts` reads the resolvers beside it and says what
// each field goes on to call, and a flow step that named a field differently
// from the method it lands on would never meet it. The spelling is written
// out twice because the two are in different languages; `extract-ts/graphql.ts`
// is the other copy.

import "strings"

// interfaceID is the interface a module's root fields land in: the api and the
// module, `storefront.v1.Basket`. A schema in one file has no module to name,
// and its fields land on the api itself.
func interfaceID(api, module string) string {
	if module == "" {
		return api
	}

	return api + "." + title(module)
}

// methodName is a root field by the operation it belongs to: `Query.basket`.
// GraphQL has no other name for it - two operations may each have a `basket`
// field, and they are not the same endpoint.
func methodName(root, field string) string { return root + "." + field }

// argsMessage names the shape a field's arguments make when they are not
// already one input object: `Query.basket(id: ID!)` gives `QueryBasketArgs`.
// The name is the one graphql-codegen generates for the same thing, so a
// reader who has the generated types open recognises it.
func argsMessage(root, field string) string { return root + title(field) + "Args" }

// title is the human form of a module name: `basket` becomes Basket,
// `order_status` becomes OrderStatus.
func title(name string) string {
	var b strings.Builder
	for _, word := range strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' || r == ' ' || r == '.' }) {
		runes := []rune(word)
		if runes[0] >= 'a' && runes[0] <= 'z' {
			runes[0] = runes[0] - 'a' + 'A'
		}
		b.WriteString(string(runes))
	}

	return b.String()
}
