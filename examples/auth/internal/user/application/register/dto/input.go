// Package dto carries what crosses the edge of the register use case: what a
// caller must supply, and what it gets back.
//
// These shapes belong to this use case alone. Nothing else reads them, so they
// are free to change when register's requirements change, without dragging
// another use case along.
package dto

// Input is a registration request as it arrives. Password is plaintext here -
// this is the last place in the system where that is true.
type Input struct {
	Email    string
	Password string
}
