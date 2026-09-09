package api

type Input struct {
	ID    string `json:"id"`
	Valid bool   `json:"valid"`
}

type Output struct {
	Accepted bool `json:"accepted"`
}

type Failure struct {
	Reason string `json:"reason"`
}
