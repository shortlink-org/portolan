package quote

// The one way through a quote's states, as a table rather than as branches of
// the methods below: a quote is issued, and then it is either used up or it
// runs out. Nothing brings an expired quote back.
const (
	StateIssued  = "issued"
	StateTaken   = "taken"
	StateExpired = "expired"
)

const (
	EventTake   = "take"
	EventExpire = "expire"
)

// Rules is the transition table. The methods of Quote are held to it: a move it
// does not list is a move nothing in this package can make.
var Rules = map[string]map[string]string{
	StateIssued: {
		EventTake:   StateTaken,
		EventExpire: StateExpired,
	},
	StateTaken:   {},
	StateExpired: {},
}
