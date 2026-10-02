package types

// CompositeBilling is the immutable price path used by a single attempt. It is
// also persisted in task JSON so settlement never depends on a live request.
type CompositeBilling struct {
	Name           string  `json:"name"`
	Version        string  `json:"version"`
	Member         string  `json:"member"`
	CompositeRatio float64 `json:"composite_ratio"`
	MemberRatio    float64 `json:"member_ratio"`
	FinalRatio     float64 `json:"final_ratio"`
}
