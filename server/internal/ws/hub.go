// Package ws is the WebSocket push of world changes (docs/ARCHITECTURE.md
// §4.5). After a committed change the server publishes the world ID on the
// Redis channel world:<id>; every instance's hub subscribes to the
// channels of the worlds of its connected players and sends
// {"type":"world_changed","world_id":…} to their sockets. Messages carry no
// game state: clients re-fetch. In --dev mode the hub is fed in-process.
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
)

// Keep-alive: the server pings every PingInterval and closes a socket whose
// pong does not arrive within PongTimeout (idle/dead peers).
const (
	PingInterval = 25 * time.Second
	PongTimeout  = 10 * time.Second
	writeTimeout = 5 * time.Second
	sendBuffer   = 4
)

// Subscriber manages the hub's subscriptions to world channels (Redis).
type Subscriber interface {
	Subscribe(ctx context.Context, id store.WorldID) error
	Unsubscribe(ctx context.Context, id store.WorldID) error
}

// Message is a push message.
type Message struct {
	Type    string `json:"type"`
	WorldID string `json:"world_id"`
}

type conn struct {
	send   chan []byte
	cancel context.CancelFunc
}

// Hub tracks the sockets of this instance by world.
type Hub struct {
	logger *slog.Logger

	mu     sync.Mutex
	conns  map[store.WorldID]map[*conn]struct{}
	sub    Subscriber
	closed bool
	wg     sync.WaitGroup

	// subMu serialises subscription changes; subscribed (guarded by subMu)
	// is the subscription state per world as last requested from the
	// subscriber. reconcile brings it in line with the current membership,
	// so concurrent last-leave and first-join cannot end unsubscribed with
	// a socket open.
	subMu      sync.Mutex
	subscribed map[store.WorldID]bool
}

// NewHub returns a hub. SetSubscriber connects it to Redis; without a
// subscriber it is fed by Notify only (dev mode).
func NewHub(logger *slog.Logger) *Hub {
	return &Hub{logger: logger, conns: map[store.WorldID]map[*conn]struct{}{}, subscribed: map[store.WorldID]bool{}}
}

// SetSubscriber sets the subscription manager (before serving sockets).
func (h *Hub) SetSubscriber(s Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sub = s
}

// Notify sends world_changed to the local sockets of a world.
func (h *Hub) Notify(id store.WorldID) {
	msg, _ := json.Marshal(Message{Type: "world_changed", WorldID: string(id)})
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns[id] {
		select {
		case c.send <- msg:
		default: // a message is already queued; the client re-fetches anyway
		}
	}
}

// Connections returns the number of open sockets.
func (h *Hub) Connections() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, cs := range h.conns {
		n += len(cs)
	}
	return n
}

func (h *Hub) add(id store.WorldID, c *conn) bool {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return false
	}
	if h.conns[id] == nil {
		h.conns[id] = map[*conn]struct{}{}
	}
	h.conns[id][c] = struct{}{}
	h.wg.Add(1)
	h.mu.Unlock()
	telemetry.WSConnections.Inc()
	h.reconcile(id)
	return true
}

func (h *Hub) remove(id store.WorldID, c *conn) {
	h.mu.Lock()
	delete(h.conns[id], c)
	if len(h.conns[id]) == 0 {
		delete(h.conns, id)
	}
	h.mu.Unlock()
	telemetry.WSConnections.Dec()
	h.reconcile(id)
	h.wg.Done()
}

// reconcile subscribes to or unsubscribes from a world's channel so that
// the subscription matches whether the world has sockets now. It runs
// under subMu and re-reads the membership, so the last call always leaves
// the correct state regardless of how adds and removes interleave.
func (h *Hub) reconcile(id store.WorldID) {
	h.subMu.Lock()
	defer h.subMu.Unlock()
	h.mu.Lock()
	want := len(h.conns[id]) > 0
	sub := h.sub
	h.mu.Unlock()
	if sub == nil || want == h.subscribed[id] {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()
	if want {
		// Recorded as subscribed even on error: the Redis client keeps the
		// channel and resubscribes after reconnecting. Meanwhile the socket
		// stays open without pushes; the client still re-fetches at
		// next_change_at and on focus.
		h.subscribed[id] = true
		if err := sub.Subscribe(ctx, id); err != nil {
			h.logger.Error("ws: subscribing to world changes failed", "world_id", string(id), "error", err)
		}
		return
	}
	delete(h.subscribed, id)
	if err := sub.Unsubscribe(ctx, id); err != nil {
		h.logger.Warn("ws: unsubscribing failed", "world_id", string(id), "error", err)
	}
}

// Serve upgrades the request (already authenticated and origin-checked by
// the caller) and serves the socket of world id until it closes.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, id store.WorldID) {
	// The HTTP server's read/write timeouts must not end the socket.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// The origin was checked by the API's CSRF rule before the upgrade.
		InsecureSkipVerify: true,
	})
	if err != nil {
		h.logger.Warn("ws: upgrade failed", "error", err)
		return
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
	defer cancel()
	c := &conn{send: make(chan []byte, sendBuffer), cancel: cancel}
	if !h.add(id, c) {
		_ = ws.Close(websocket.StatusGoingAway, "server shutting down")
		return
	}
	defer h.remove(id, c)
	ctx = ws.CloseRead(ctx)
	ping := time.NewTicker(PingInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = ws.Close(websocket.StatusGoingAway, "closing")
			return
		case msg := <-c.send:
			wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
			err := ws.Write(wctx, websocket.MessageText, msg)
			wcancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, pcancel := context.WithTimeout(ctx, PongTimeout)
			err := ws.Ping(pctx)
			pcancel()
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					_ = ws.Close(websocket.StatusPolicyViolation, "pong timeout")
				}
				return
			}
		}
	}
}

// Close closes every socket and refuses new ones; it waits until the
// socket handlers have returned or ctx expires.
func (h *Hub) Close(ctx context.Context) {
	h.mu.Lock()
	h.closed = true
	for _, cs := range h.conns {
		for c := range cs {
			c.cancel()
		}
	}
	h.mu.Unlock()
	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// LocalPublisher feeds the hub in-process (dev mode, one instance).
type LocalPublisher struct{ Hub *Hub }

// Publish implements the API's and the worker's publisher.
func (p LocalPublisher) Publish(_ context.Context, id store.WorldID) { p.Hub.Notify(id) }
