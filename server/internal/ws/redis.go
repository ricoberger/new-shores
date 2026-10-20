package ws

import (
	"context"
	"log/slog"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
)

// ChannelPrefix prefixes the Redis channel of a world: world:<id>.
const ChannelPrefix = "world:"

// RedisPublisher publishes committed world changes on world:<id>.
// Publishing never fails a request: errors are logged and counted
// (ws_publish_errors_total).
type RedisPublisher struct {
	Client *redis.Client
	Logger *slog.Logger
}

// Publish implements the API's and the worker's publisher.
func (p RedisPublisher) Publish(ctx context.Context, id store.WorldID) {
	if err := p.Client.Publish(context.WithoutCancel(ctx), ChannelPrefix+string(id), string(id)).Err(); err != nil {
		telemetry.PublishErrors.Inc()
		p.Logger.Error("ws: publishing world change failed", "world_id", string(id), "error", err)
	}
}

// RedisSubscriber subscribes the hub to world channels on one Redis pub/sub
// connection (go-redis reconnects and resubscribes after an outage) and
// forwards messages to the hub.
type RedisSubscriber struct {
	ps     *redis.PubSub
	hub    *Hub
	logger *slog.Logger
	done   chan struct{}
}

// NewRedisSubscriber starts the receive loop and attaches the subscriber
// to the hub.
func NewRedisSubscriber(ctx context.Context, client *redis.Client, hub *Hub, logger *slog.Logger) *RedisSubscriber {
	s := &RedisSubscriber{ps: client.Subscribe(ctx), hub: hub, logger: logger, done: make(chan struct{})}
	go s.loop()
	hub.SetSubscriber(s)
	return s
}

func (s *RedisSubscriber) loop() {
	defer close(s.done)
	for msg := range s.ps.Channel() {
		if id, ok := strings.CutPrefix(msg.Channel, ChannelPrefix); ok {
			s.hub.Notify(store.WorldID(id))
		}
	}
}

// Subscribe implements Subscriber.
func (s *RedisSubscriber) Subscribe(ctx context.Context, id store.WorldID) error {
	return s.ps.Subscribe(ctx, ChannelPrefix+string(id))
}

// Unsubscribe implements Subscriber.
func (s *RedisSubscriber) Unsubscribe(ctx context.Context, id store.WorldID) error {
	return s.ps.Unsubscribe(ctx, ChannelPrefix+string(id))
}

// Close stops the receive loop.
func (s *RedisSubscriber) Close() error {
	err := s.ps.Close()
	<-s.done
	return err
}
