package cart

import (
	"encoding/json"
	"fmt"
)

// Decode turns a message off the cart's subject into the event it names. A
// name this service does not read comes back as nil and no error: a policy
// handed nil passes it over, and an event the cart adds tomorrow is not a
// failure here today. A field the cart stopped sending is an error, not a
// silent zero.
func Decode(name string, payload []byte) (Event, error) {
	switch name {
	case BasketCheckedOut{}.Name():
		var e BasketCheckedOut
		if err := json.Unmarshal(payload, &e); err != nil {
			return nil, fmt.Errorf("cart: %s: %w", name, err)
		}
		if e.BasketID == "" {
			return nil, fmt.Errorf("cart: %s: no basketId on the message", name)
		}

		return e, nil
	}

	return nil, nil
}
