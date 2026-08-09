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
	// Each socket gets a fresh ID; give it a fresh MemberID too, matching the
	// real client behaviour. Tests that simulate a reconnect reuse the same
	// MemberID across two sockets to prove upsert.
	return &Client{ID: NewID(), MemberID: NewID(), RoomID: roomID, Send: make(chan []byte, 64)}
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

func TestReconnectUpsertNoDuplicate(t *testing.T) {
	_, hub, ctx := setup(t)

	// Host joins on socket #1.
	host1 := newClient("room-reconnect")
	if err := hub.HandleMessage(ctx, host1, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}}); err != nil {
		t.Fatal(err)
	}
	if host1.role != "host" {
		t.Fatalf("first joiner should be host, got %q", host1.role)
	}

	st, _ := hub.store.GetState(ctx, "room-reconnect")
	if len(st.Members) != 1 {
		t.Fatalf("expected 1 member after host join, got %d", len(st.Members))
	}
	if st.Members[host1.MemberID] == nil {
		t.Fatal("host member should be keyed by MemberID")
	}

	// Same person reconnects on a NEW socket with the SAME MemberID.
	host2 := newClient("room-reconnect")
	host2.MemberID = host1.MemberID // stable identity reused across reconnect
	if err := hub.HandleMessage(ctx, host2, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}}); err != nil {
		t.Fatal(err)
	}

	st2, _ := hub.store.GetState(ctx, "room-reconnect")
	if len(st2.Members) != 1 {
		t.Fatalf("reconnect must NOT duplicate the member, got %d members", len(st2.Members))
	}
	if host2.role != "host" {
		t.Fatalf("host role should be preserved on reconnect, got %q", host2.role)
	}
	if st2.Members[host2.MemberID] == nil || st2.Members[host2.MemberID].Role != "host" {
		t.Fatalf("reconnected host should still be host: %+v", st2.Members)
	}
}

func TestMemberLeaveOnlyRemovesItself(t *testing.T) {
	_, hub, ctx := setup(t)

	host := newClient("room-leave")
	_ = hub.HandleMessage(ctx, host, &types.Message{Type: "join", Data: map[string]interface{}{"name": "alice"}})
	member := newClient("room-leave")
	_ = hub.HandleMessage(ctx, member, &types.Message{Type: "join", Data: map[string]interface{}{"name": "bob"}})

	// Member leaves; host must remain and stay host.
	if err := hub.HandleMessage(ctx, member, &types.Message{Type: "leave"}); err != nil {
		t.Fatal(err)
	}
	st, _ := hub.store.GetState(ctx, "room-leave")
	if len(st.Members) != 1 {
		t.Fatalf("expected 1 member after member leave, got %d", len(st.Members))
	}
	if st.Members[host.MemberID] == nil {
		t.Fatal("host should still be present after member leaves")
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
