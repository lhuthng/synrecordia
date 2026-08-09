package room

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/synrecordia/synrecordia/apps/relay/internal/config"
	"github.com/synrecordia/synrecordia/apps/relay/internal/types"
)

// Client is one active WebSocket connection.
type Client struct {
	ID       string // unique socket id (one per connection)
	MemberID string // stable per-browser identity (same across reconnects)
	RoomID   string
	name     string
	role     string
	Conn     *websocket.Conn
	Send     chan []byte
}

// Hub owns the in-process connection set and coordinates with the Redis Store.
type Hub struct {
	cfg   config.Config
	store *Store
	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{} // roomID -> set of clients
}

// NewHub builds a Hub bound to the given store.
func NewHub(cfg config.Config, store *Store) *Hub {
	return &Hub{cfg: cfg, store: store, rooms: map[string]map[*Client]struct{}{}}
}

// Add registers a client and starts its writer pump.
func (h *Hub) Add(c *Client) {
	h.mu.Lock()
	if h.rooms[c.RoomID] == nil {
		h.rooms[c.RoomID] = map[*Client]struct{}{}
		h.store.Subscribe(c.RoomID, func(raw []byte) {
			h.broadcastRaw(c.RoomID, raw)
		})
	}
	h.rooms[c.RoomID][c] = struct{}{}
	h.mu.Unlock()
	go c.writePump()
}

// Remove unregisters a client, cleaning the room when it empties.
func (h *Hub) Remove(c *Client) {
	h.mu.Lock()
	if set, ok := h.rooms[c.RoomID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.rooms, c.RoomID)
			h.store.Unsubscribe(c.RoomID)
		}
	}
	h.mu.Unlock()
}

// HandleMessage routes an inbound client message.
func (h *Hub) HandleMessage(ctx context.Context, c *Client, msg *types.Message) error {
	switch msg.Type {
	case "ping":
		return c.write(types.Message{Type: "pong", RoomID: c.RoomID})
	case "join":
		if msg.Data != nil {
			if d, ok := msg.Data.(map[string]interface{}); ok {
				if n, ok := d["name"].(string); ok && n != "" {
					c.name = n
				}
				if r, ok := d["role"].(string); ok {
					c.role = r
				}
				if id, ok := d["memberId"].(string); ok && id != "" {
					c.MemberID = id
				}
			}
		}
		if c.MemberID == "" {
			c.MemberID = c.ID // legacy clients without a stable id
		}
		return h.handleJoin(ctx, c)
	case "config":
		return h.handleConfig(ctx, c, msg.Data)
	case "broadcast":
		raw, _ := json.Marshal(types.Message{Type: "broadcast", RoomID: c.RoomID, Data: msg.Data})
		return h.store.Publish(ctx, c.RoomID, raw)
	case "leave":
		h.Remove(c)
		return h.handleLeave(ctx, c)
	default:
		return c.write(types.Message{Type: "error", RoomID: c.RoomID, Data: "unknown message type"})
	}
}

func (h *Hub) broadcastRaw(roomID string, raw []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.rooms[roomID] {
		select {
		case c.Send <- raw:
		default: // slow client: drop rather than block the hub
		}
	}
}

func (h *Hub) handleJoin(ctx context.Context, c *Client) error {
	st, err := h.store.GetState(ctx, c.RoomID)
	if err != nil {
		return err
	}
	if st == nil { // first joiner becomes host
		if len(h.rooms) >= h.cfg.MaxRooms {
			return c.write(types.Message{Type: "error", RoomID: c.RoomID, Data: "server at room capacity"})
		}
		st = types.NewRoom(c.RoomID, c.MemberID, c.name)
		c.role = "host"
	} else {
		// Upsert by the stable memberId — a reconnect replaces the existing
		// entry instead of appending a duplicate (fixes "I see myself twice").
		existing := st.Members[c.MemberID]
		if existing == nil && len(st.Members) >= h.cfg.MaxPerRoom {
			return c.write(types.Message{Type: "error", RoomID: c.RoomID, Data: "room full"})
		}
		role := c.role
		if c.role == "host" {
			// Only the current host (or a hostless room) may hold host role.
			if st.HostID == "" || st.HostID == c.MemberID {
				role = "host"
			} else {
				role = "member"
			}
		}
		// Preserve host role across reconnect for the current host.
		if existing != nil && existing.Role == "host" {
			role = "host"
		}
		c.role = role
		st.Members[c.MemberID] = &types.Member{
			ID:       c.MemberID,
			MemberID: c.MemberID,
			Name:     c.name,
			Role:     role,
		}
		if role == "host" {
			st.HostID = c.MemberID
		}
	}
	if err := h.store.SaveState(ctx, st); err != nil {
		return err
	}
	raw, _ := json.Marshal(types.Message{Type: "state", RoomID: c.RoomID, Data: st})
	if err := h.store.Publish(ctx, c.RoomID, raw); err != nil {
		return err
	}
	return c.write(types.Message{Type: "state", RoomID: c.RoomID, Data: st})
}

func (h *Hub) handleLeave(ctx context.Context, c *Client) error {
	st, err := h.store.GetState(ctx, c.RoomID)
	if err != nil || st == nil {
		return err
	}
	delete(st.Members, c.MemberID)
	if c.role == "host" { // host left: close the room
		_ = h.store.DeleteState(ctx, c.RoomID)
		raw, _ := json.Marshal(types.Message{Type: "leave", RoomID: c.RoomID, Data: "host left; room closed"})
		return h.store.Publish(ctx, c.RoomID, raw)
	}
	if len(st.Members) == 0 {
		return h.store.DeleteState(ctx, c.RoomID)
	}
	if err := h.store.SaveState(ctx, st); err != nil {
		return err
	}
	raw, _ := json.Marshal(types.Message{Type: "state", RoomID: c.RoomID, Data: st})
	return h.store.Publish(ctx, c.RoomID, raw)
}

func (h *Hub) handleConfig(ctx context.Context, c *Client, data interface{}) error {
	if c.role != "host" {
		return c.write(types.Message{Type: "error", RoomID: c.RoomID, Data: "only host may configure"})
	}
	st, err := h.store.GetState(ctx, c.RoomID)
	if err != nil || st == nil {
		return err
	}
	if cfg, ok := data.(map[string]interface{}); ok {
		st.Config = cfg
	}
	if err := h.store.SaveState(ctx, st); err != nil {
		return err
	}
	raw, _ := json.Marshal(types.Message{Type: "config", RoomID: c.RoomID, Data: st.Config})
	return h.store.Publish(ctx, c.RoomID, raw)
}

func (c *Client) write(m types.Message) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	select {
	case c.Send <- raw:
		return nil
	default:
		return nil
	}
}

func (c *Client) writePump() {
	defer c.Conn.Close()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// NewID returns a random hex identifier for clients/rooms.
func NewID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
