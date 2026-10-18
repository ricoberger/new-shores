package content

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// ParseFixed converts a decimal JSON number into a fixed-point integer with
// the given number of decimal places (e.g. places = 3 converts "0.05" into
// 50). It is exact: numbers with more decimal places than allowed, exponents
// or values that overflow int64 are rejected instead of rounded.
func ParseFixed(n json.Number, places int) (int64, error) {
	s := n.String()
	if strings.ContainsAny(s, "eE") {
		return 0, fmt.Errorf("number %q: exponent notation is not supported", s)
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	intPart, fracPart, _ := strings.Cut(s, ".")
	fracPart = strings.TrimRight(fracPart, "0")
	if len(fracPart) > places {
		return 0, fmt.Errorf("number %q: more than %d decimal places", n.String(), places)
	}
	fracPart += strings.Repeat("0", places-len(fracPart))
	digits := intPart + fracPart
	if digits == "" {
		return 0, fmt.Errorf("number %q: no digits", n.String())
	}
	var v int64
	for _, r := range digits {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("number %q: invalid digit", n.String())
		}
		d := int64(r - '0')
		if v > (math.MaxInt64-d)/10 {
			return 0, fmt.Errorf("number %q: out of range", n.String())
		}
		v = v*10 + d
	}
	if neg {
		v = -v
	}
	return v, nil
}
