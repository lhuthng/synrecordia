package songs

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog.json
var catalogJSON []byte

// Song is one entry of the song catalog served by /api/songs. The shape
// mirrors the web app's static public/songs/index.json so the client can use
// the API and static index interchangeably.
//
// NOTE: this file is a copy of apps/web/public/songs/index.json. Keep them in
// sync (or generate this from that file in CI) when adding/removing songs.
type Song struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Composer   string `json:"composer,omitempty"`
	BPM        int    `json:"bpm"`
	File       string `json:"file"`
	Difficulty string `json:"difficulty,omitempty"`
}

// Load returns the bundled song catalog as raw JSON.
func Load() []byte {
	return catalogJSON
}

// Parse decodes the catalog for programmatic use.
func Parse() ([]Song, error) {
	var songs []Song
	err := json.Unmarshal(catalogJSON, &songs)
	return songs, err
}
