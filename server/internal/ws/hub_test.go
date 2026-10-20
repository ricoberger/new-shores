package ws

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/store"
)

// probeSubscriber records the subscription state; Unsubscribe blocks until
// released so that a reconnect can race it.
type probeSubscriber struct {
	mu          sync.Mutex
	subscribed  map[store.WorldID]bool
	unsubEnter  chan struct{}
	unsubResume chan struct{}
}

func (p *probeSubscriber) Subscribe(_ context.Context, id store.WorldID) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.subscribed[id] = true
	return nil
}

func (p *probeSubscriber) Unsubscribe(_ context.Context, id store.WorldID) error {
	if p.unsubEnter != nil {
		p.unsubEnter <- struct{}{}
		<-p.unsubResume
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.subscribed, id)
	return nil
}

func (p *probeSubscriber) is(id store.WorldID) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.subscribed[id]
}

func newConn() *conn { return &conn{send: make(chan []byte, sendBuffer), cancel: func() {}} }

// TestReconnectDuringUnsubscribeKeepsTheSubscription: the last socket of a
// world leaves (its unsubscribe is slow) while a replacement socket joins;
// the world must end up subscribed.
func TestReconnectDuringUnsubscribeKeepsTheSubscription(t *testing.T) {
	sub := &probeSubscriber{subscribed: map[store.WorldID]bool{}, unsubEnter: make(chan struct{}), unsubResume: make(chan struct{})}
	h := NewHub(slog.New(slog.DiscardHandler))
	h.SetSubscriber(sub)
	const w store.WorldID = "w"
	old := newConn()
	if !h.add(w, old) || !sub.is(w) {
		t.Fatal("first socket did not subscribe")
	}
	removed := make(chan struct{})
	go func() {
		h.remove(w, old)
		close(removed)
	}()
	<-sub.unsubEnter // the old socket's unsubscribe is in progress
	added := make(chan struct{})
	replacement := newConn()
	go func() {
		h.add(w, replacement)
		close(added)
	}()
	time.Sleep(50 * time.Millisecond) // let the replacement join meanwhile
	close(sub.unsubResume)
	<-removed
	<-added
	if !sub.is(w) {
		t.Fatal("replacement socket is open but the world is unsubscribed")
	}
	if h.Connections() != 1 {
		t.Fatalf("connections %d", h.Connections())
	}
	// The world is unsubscribed once its last socket leaves.
	sub.unsubEnter = nil
	h.remove(w, replacement)
	if sub.is(w) {
		t.Fatal("still subscribed without sockets")
	}
}

func TestNotifyReachesTheWorldsSockets(t *testing.T) {
	h := NewHub(slog.New(slog.DiscardHandler))
	a, b := newConn(), newConn()
	h.add("a", a)
	h.add("b", b)
	h.Notify("a")
	select {
	case msg := <-a.send:
		if string(msg) != `{"type":"world_changed","world_id":"a"}` {
			t.Fatalf("message %s", msg)
		}
	default:
		t.Fatal("no message for a")
	}
	select {
	case <-b.send:
		t.Fatal("b got a's message")
	default:
	}
	h.remove("a", a)
	h.remove("b", b)
}
