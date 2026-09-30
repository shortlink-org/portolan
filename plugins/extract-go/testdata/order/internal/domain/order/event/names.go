package event

// prefix is what every order event is called under.
const prefix = "order."

// TopicPlaced is built from the prefix, in a file of its own: the name is
// followed through both.
const TopicPlaced = prefix + "Placed"
