package songs

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog.json
var catalogJSON []byte

// Load returns the bundled song/sample catalog as raw JSON. For MVP this is a
// small static manifest; a future phase can merge in Redis/S3-backed data.
func Load() []byte {
	return catalogJSON
}

// Catalog is a typed view of the manifest (used for future filtering).
type Catalog struct {
	Version string   `json:"version"`
	Songs   []string `json:"songs"`
}

// Parse decodes the manifest for programmatic use.
func Parse() (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
