// The shape protoc-gen-go produces for ../../proto/risk/v1/risk.proto, written
// by hand and kept to what this service uses, so the example builds without
// protoc on the machine. The names are the generator's; the messages are plain
// structs rather than protoimpl-backed ones, which is the one liberty taken.
package riskpb

// Verdict is closed on purpose: a caller switches on it.
type Verdict int32

const (
	Verdict_VERDICT_UNSPECIFIED Verdict = 0
	Verdict_VERDICT_ALLOW       Verdict = 1
	// Refuse the attempt and treat the account as compromised.
	Verdict_VERDICT_BLOCK Verdict = 2
)

type AssessRequest struct {
	// The user the attempt is for.
	UserId string
}

func (x *AssessRequest) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

type AssessResponse struct {
	Verdict Verdict
}

func (x *AssessResponse) GetVerdict() Verdict {
	if x != nil {
		return x.Verdict
	}
	return Verdict_VERDICT_UNSPECIFIED
}
