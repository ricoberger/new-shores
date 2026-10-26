package archipelago

// rng is a splitmix64 generator: small, fast and fully determined by its
// state, so the same seed gives the same sequence on every platform. The
// package uses no other source of randomness (no math/rand global state).
type rng struct{ s uint64 }

func newRNG(seed uint64) *rng { return &rng{s: seed} }

// next returns the next 64 random bits (splitmix64).
func (r *rng) next() uint64 {
	r.s += 0x9e3779b97f4a7c15
	return mix64(r.s)
}

// mix64 is the splitmix64 finaliser.
func mix64(z uint64) uint64 {
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// derive returns a sub-seed of seed for the given stream tag.
func derive(seed, tag uint64) uint64 {
	return mix64(seed ^ mix64(tag+0x632be59bd9b4e019))
}

// intn returns a uniform integer in [0, n) for n > 0 (rejection sampling,
// no modulo bias).
func (r *rng) intn(n int) int {
	if n <= 1 {
		return 0
	}
	un := uint64(n) // #nosec G115 -- n > 1
	limit := ^uint64(0) - (^uint64(0) % un)
	for {
		v := r.next()
		if v < limit {
			return int(v % un) // #nosec G115 -- v % un < n
		}
	}
}

// between returns a uniform integer in [lo, hi] (lo when hi < lo).
func (r *rng) between(lo, hi int) int {
	if hi <= lo {
		return lo
	}
	return lo + r.intn(hi-lo+1)
}

// shuffle permutes n elements (Fisher-Yates).
func (r *rng) shuffle(n int, swap func(i, j int)) {
	for i := n - 1; i > 0; i-- {
		swap(i, r.intn(i+1))
	}
}
