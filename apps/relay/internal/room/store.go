package room

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/synrecordia/synrecordia/apps/relay/internal/config"
	"github.com/synrecordia/synrecordia/apps/relay/internal/types"
)

const (
	statePrefix  = "room:state:"
	channelPrefix = "room:chan:"
)

// Store wraps Redis for room state persistence and cross-replica pub/sub.
type Store struct {
	rdb      *redis.Client
	sub      *redis.PubSub
	mu       sync.Mutex
	handlers map[string]func([]byte) // roomID -> broadcast handler
	cfg      config.Config
}

// NewStore dials Redis and returns a Store ready for use. It returns the
// store and a close func.
func NewStore(ctx context.Context, cfg config.Config) (*Store, func(), error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, nil, fmt.Errorf("redis ping: %w", err)
	}
	s := &Store{rdb: rdb, sub: rdb.Subscribe(ctx), handlers: map[string]func([]byte){}, cfg: cfg}
	go s.readLoop(ctx)
	return s, func() { _ = s.sub.Close(); _ = rdb.Close() }, nil
}

// Ready reports whether Redis is reachable (used by /readyz).
func (s *Store) Ready(ctx context.Context) error { return s.rdb.Ping(ctx).Err() }

// GetState loads the current room snapshot. Returns nil, nil if the room does
// not exist.
func (s *Store) GetState(ctx context.Context, roomID string) (*types.RoomState, error) {
	raw, err := s.rdb.Get(ctx, statePrefix+roomID).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var st types.RoomState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// SaveState persists a snapshot and bumps its version.
func (s *Store) SaveState(ctx context.Context, st *types.RoomState) error {
	st.Version++
	st.Updated = time.Now().UTC()
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, statePrefix+st.RoomID, raw, s.cfg.RoomTTL).Err()
}

// DeleteState removes a room (e.g. when it empties / host leaves).
func (s *Store) DeleteState(ctx context.Context, roomID string) error {
	return s.rdb.Del(ctx, statePrefix+roomID).Err()
}

// Subscribe registers a callback invoked when any replica publishes to the
// room's channel. Used to fan out messages to all in-process connections.
func (s *Store) Subscribe(roomID string, fn func([]byte)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.handlers[roomID]; ok {
		return
	}
	s.handlers[roomID] = fn
	_ = s.sub.Subscribe(context.Background(), channelPrefix+roomID)
}

// Unsubscribe drops the room's callback and channel.
func (s *Store) Unsubscribe(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.handlers[roomID]; ok {
		delete(s.handlers, roomID)
		_ = s.sub.Unsubscribe(context.Background(), channelPrefix+roomID)
	}
}

// Publish sends a raw message to the room channel across all replicas.
func (s *Store) Publish(ctx context.Context, roomID string, raw []byte) error {
	return s.rdb.Publish(ctx, channelPrefix+roomID, raw).Err()
}

func (s *Store) readLoop(ctx context.Context) {
	ch := s.sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			roomID := msg.Channel[len(channelPrefix):]
			s.mu.Lock()
			fn := s.handlers[roomID]
			s.mu.Unlock()
			if fn != nil {
				fn([]byte(msg.Payload))
			}
		}
	}
}
