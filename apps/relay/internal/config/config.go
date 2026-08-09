package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds runtime configuration sourced from environment variables so the
// same binary works locally and in ECS.
type Config struct {
	// Addr is the address the HTTP/WS server binds to (e.g. ":8080").
	Addr string

	// RedisAddr is the Redis endpoint, e.g. "localhost:6379" or an ElastiCache
	// host:port. Auth token optional.
	RedisAddr string
	RedisPassword string
	RedisDB   int

	// RelayToken, when non-empty, is required as a bearer token on /api*
	// requests (via ?token= or Authorization: Bearer). Optional for MVP.
	RelayToken string

	// RoomTTL is how long an idle room's state persists in Redis before expiry.
	RoomTTL time.Duration

	// HeartbeatInterval controls server ping cadence and read deadlines.
	HeartbeatInterval time.Duration

	// MaxRooms / MaxPerRoom bound resource usage (DoS guard).
	MaxRooms   int
	MaxPerRoom int
}

// FromEnv builds a Config from environment variables with sensible defaults.
func FromEnv() Config {
	return Config{
		Addr:              env("ADDR", ":8080"),
		RedisAddr:         env("REDIS_URL", "localhost:6379"),
		RedisPassword:     env("REDIS_PASSWORD", ""),
		RedisDB:           envInt("REDIS_DB", 0),
		RelayToken:        env("RELAY_TOKEN", ""),
		RoomTTL:           envDur("ROOM_TTL", DefaultRoomTTL()),
		HeartbeatInterval: envDur("HEARTBEAT_INTERVAL", 30*time.Second),
		MaxRooms:          envInt("MAX_ROOMS", 1000),
		MaxPerRoom:        envInt("MAX_PER_ROOM", 50),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// DefaultRoomTTL returns the default idle-room expiry used by tests and local runs.
func DefaultRoomTTL() time.Duration {
	return 2 * time.Hour
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDur(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
