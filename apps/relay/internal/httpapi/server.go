package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/synrecordia/synrecordia/apps/relay/internal/config"
	"github.com/synrecordia/synrecordia/apps/relay/internal/room"
	"github.com/synrecordia/synrecordia/apps/relay/internal/types"
)

// Server wires HTTP/WS routes to the room Hub and Redis Store.
type Server struct {
	cfg    config.Config
	hub    *room.Hub
	store  *room.Store
	up     websocket.Upgrader
	songDB []byte // bundled /api catalog (JSON), read once
}

// NewServer builds the Server.
func NewServer(cfg config.Config, hub *room.Hub, store *room.Store, songDB []byte) *Server {
	return &Server{
		cfg:    cfg,
		hub:    hub,
		store:  store,
		songDB: songDB,
		up: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// MVP: allow all origins (ALB terminates TLS; add allowlist later).
				return true
			},
		},
	}
}

// Routes returns the root http.Handler.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/readyz", s.handleReadyz)
	mux.HandleFunc("/ws/", s.handleWS)
	mux.HandleFunc("/api/songs", s.handleSongs)
	mux.HandleFunc("/api/config", s.handleConfig)
	return s.withLogging(mux)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ready(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unready", "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// handleWS upgrades the connection and runs the read loop.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	// Path form: /ws/<roomID>
	roomID := strings.TrimPrefix(r.URL.Path, "/ws/")
	roomID = strings.TrimSuffix(roomID, "/")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing room id"})
		return
	}
	conn, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &room.Client{ID: room.NewID(), RoomID: roomID, Conn: conn, Send: make(chan []byte, 64)}
	s.hub.Add(c)
	defer func() {
		s.hub.Remove(c)
		_ = conn.Close()
	}()

	ctx := r.Context()
	conn.SetReadLimit(4096)
	conn.SetReadDeadline(time.Now().Add(s.cfg.HeartbeatInterval))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(s.cfg.HeartbeatInterval))
		return nil
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			// connection closed / read deadline exceeded: stop pumping
			return
		}
		var msg types.Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			_ = conn.WriteJSON(types.Message{Type: "error", RoomID: roomID, Data: "invalid JSON"})
			continue
		}
		if err := s.hub.HandleMessage(ctx, c, &msg); err != nil {
			log.Printf("handle message: %v", err)
			return
		}
	}
}

func (s *Server) handleSongs(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(s.songDB)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"websocketPath": "/ws/{roomId}",
		"maxPerRoom":    s.cfg.MaxPerRoom,
		"heartbeatMs":   s.cfg.HeartbeatInterval.Milliseconds(),
	})
}

// authorized checks the optional relay token via ?token= or Bearer header.
func (s *Server) authorized(r *http.Request) bool {
	if s.cfg.RelayToken == "" {
		return true // token auth disabled
	}
	if r.URL.Query().Get("token") == s.cfg.RelayToken {
		return true
	}
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return bearer == s.cfg.RelayToken
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
