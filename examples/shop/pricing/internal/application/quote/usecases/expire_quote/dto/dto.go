package dto

// Input is the sweep's one question: expire everything open before this.
type Input struct {
	Before string
}

// Output says how many promises lapsed.
type Output struct {
	Expired int
}
