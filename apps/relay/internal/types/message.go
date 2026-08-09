package types

import "time"

// Message is the wire envelope exchanged with WebSocket clients.
type Message struct {
	Type   string      `json:"type"`             // join | leave | state | config | broadcast | error | ping | pong
	RoomID string      `json:"roomId,omitempty"` // echo the room for multi-connection clients
	Data   interface{} `json:"data,omitempty"`
}

// RoomState is the authoritative shared state persisted in Redis. Only the host
// may mutate Config; everyone sees the full snapshot on (re)join.
type RoomState struct {
	RoomID  string                 `json:"roomId"`
	HostID  string                 `json:"hostId"`
	Config  map[string]interface{} `json:"config"`
	Members map[string]*Member     `json:"members"`
	Version int64                  `json:"version"` // bumped on each mutation
	Updated time.Time              `json:"updated"`
}

// Member describes one connected participant.
//
// MemberID is the stable per-browser identity supplied by the client on join
// (see handleJoin in the hub). It is the key of RoomState.Members, so a client
// that reconnects upserts (replaces) its entry instead of creating a duplicate.
// ID is kept equal to MemberID for backward compatibility with older clients
// that read Member.ID.
type Member struct {
	ID       string `json:"id"`
	MemberID string `json:"memberId,omitempty"`
	Name     string `json:"name"`
	Role     string `json:"role"` // host | member
}

// NewRoom returns an initial empty room state.
func NewRoom(roomID, hostID, hostName string) *RoomState {
	return &RoomState{
		RoomID:  roomID,
		HostID:  hostID,
		Config:  map[string]interface{}{},
		Members: map[string]*Member{hostID: {ID: hostID, Name: hostName, Role: "host"}},
		Version: 1,
		Updated: time.Now().UTC(),
	}
}
