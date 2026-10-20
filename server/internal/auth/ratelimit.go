package auth

import (
	"context"
	"log/slog"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ricoberger/new-shores/server/internal/telemetry"
)

// Limiter is a rate limiter keyed by an arbitrary string.
type Limiter interface {
	// Allow takes one token of key's bucket. When the bucket is empty it
	// returns false and the time until the next token.
	Allow(ctx context.Context, key string) (bool, time.Duration)
}

// RedisLimiter is a token bucket per key in Redis (capacity Burst, refilled
// at Rate tokens per Per). When Redis is unreachable it fails open: the
// request is allowed, the outage is logged once at error level and counted
// (ratelimit_fail_open_total). Rate limiting is the only auth function
// that depends on Redis.
type RedisLimiter struct {
	Client *redis.Client
	Prefix string
	Burst  int
	Rate   int
	Per    time.Duration
	Logger *slog.Logger
	// Now is the wall clock of the bucket (time.Now when nil).
	Now func() time.Time

	down atomic.Bool
}

// tokenBucket: KEYS[1] bucket; ARGV: capacity, refill per ms, now ms, ttl ms.
// Returns {allowed, retry_after_ms}.
var tokenBucket = redis.NewScript(`
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1])
local ts = tonumber(b[2])
if tokens == nil then
  tokens = cap
  ts = now
end
if now > ts then
  tokens = math.min(cap, tokens + (now - ts) * rate)
  ts = now
end
local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(ts))
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, retry}
`)

// Allow implements Limiter.
func (l *RedisLimiter) Allow(ctx context.Context, key string) (bool, time.Duration) {
	now := time.Now
	if l.Now != nil {
		now = l.Now
	}
	ratePerMs := float64(l.Rate) / float64(l.Per.Milliseconds())
	ttl := l.Per.Milliseconds() * 2
	res, err := tokenBucket.Run(ctx, l.Client, []string{l.Prefix + key},
		l.Burst, strconv.FormatFloat(ratePerMs, 'g', -1, 64), now().UnixMilli(), ttl).Int64Slice()
	if err != nil || len(res) != 2 {
		telemetry.RateLimitFailOpen.Inc()
		if !l.down.Swap(true) {
			l.Logger.Error("rate limiter unavailable (Redis); failing open until it recovers", "error", err)
		}
		return true, 0
	}
	if l.down.Swap(false) {
		l.Logger.Info("rate limiter recovered")
	}
	if res[0] == 1 {
		return true, 0
	}
	return false, time.Duration(res[1]) * time.Millisecond
}
