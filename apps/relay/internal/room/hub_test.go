package room

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/synrecordia/synrecordia/apps/relay/internal/config"
	"github.com/synrecordia/synrecordia/apps/relay/internal/types"
)

func setup(t *testing.T) (*Store, *Hub, context.Context) {
	t.Helper()
	mr := miniredis.RunT(t)
	cfg := config.Config{
		RedisAddr:  mr.Addr(),
		RoomTTL:    config.DefaultRoomTTL(),
		MaxRooms:   10,
		MaxPerRoom: 5,
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{rdb: rdb, sub: rdb.Subscribe(context.Background()), handlers: map[string]func([]byte){}, cfg: cfg}
	go store.readLoop(context.Background())
	hub := NewHub(cfg, store)
	return store, hub, context.Background()
}

func newClient(roomID string) *Client {
	return &Client{ID: NewID(), RoomID: roomID, Send: make(chan []byte, 64)}
}

func TestHostAuthorityAndConfig(t *testing.T) {
	_, hub, ctx := setup(t)

	host := newClient("room-1")
	host.role = ""
	if err := hub.HandleMessage(ctx, host, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}}); err != nil {
		t.Fatal(err)
	}
	if host.role != "host" {
		t.Fatalf("first joiner should be host, got %q", host.role)
	}

	member := newClient("room-1")
	if err := hub.HandleMessage(ctx, member, &types.Message{Type: "join", Data: map[string]interface{}{"name": "bob", "role": "host"}}); err != nil {
		t.Fatal(err)
	}
	if member.role == "host" {
		t.Fatal("non-first joiner must not become host")
	}

	// Host updates config.
	if err := hub.HandleMessage(ctx, host, &types.Message{Type: "config", Data: map[string]interface{}{"bpm": 120}}); err != nil {
		t.Fatal(err)
	}
	st, err := hub.store.GetState(ctx, "room-1")
	if err != nil {
		t.Fatal(err)
	}
	if st.Config["bpm"] != float64(120) {
		t.Fatalf("host config not saved: %+v", st.Config)
	}
	if st.Version < 1 {
		t.Fatalf("version should bump, got %d", st.Version)
	}

	// Member must NOT be able to change config.
	member.role = "member"
	if err := hub.HandleMessage(ctx, member, &types.Message{Type: "config", Data: map[string]interface{}{"bpm": 999}}); err != nil {
		t.Fatal(err)
	}
	st2, _ := hub.store.GetState(ctx, "room-1")
	if st2.Config["bpm"] != float64(120) {
		t.Fatalf("member modified config: %+v", st2.Config)
	}
}

func TestRejoinResync(t *testing.T) {
	store, hub, ctx := setup(t)

	a := newClient("room-2")
	_ = hub.HandleMessage(ctx, a, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}})
	_ = hub.HandleMessage(ctx, a, &types.Message{Type: "config", Data: map[string]interface{}{"song": "yuna"}})

	// Simulate a fresh connection re-subscribing to the same room.
	b := newClient("room-2")
	if err := hub.HandleMessage(ctx, b, &types.Message{Type: "join", Data: map[string]interface{}{"name": "bob"}}); err != nil {
		t.Fatal(err)
	}

	// Verify state is shared/persisted in Redis (across replicas).
	st, err := store.GetState(ctx, "room-2")
	if err != nil {
		t.Fatal(err)
	}
	if st.Config["song"] != "yuna" {
		t.Fatalf("state not shared across joins: %+v", st.Config)
	}
	if len(st.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(st.Members))
	}
}

func TestEmptyRoomCleanup(t *testing.T) {
	_, hub, ctx := setup(t)

	a := newClient("room-3")
	_ = hub.HandleMessage(ctx, a, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}})
	// Host leaves -> room deleted.
	if err := hub.HandleMessage(ctx, a, &types.Message{Type: "leave"}); err != nil {
		t.Fatal(err)
	}
	st, err := hub.store.GetState(ctx, "room-3")
	if err != nil {
		t.Fatal(err)
	}
	if st != nil {
		t.Fatal("room should be deleted after host leaves")
	}
}
