package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/synrecordia/synrecordia/apps/relay/internal/config"
	"github.com/synrecordia/synrecordia/apps/relay/internal/httpapi"
	"github.com/synrecordia/synrecordia/apps/relay/internal/room"
)

func main() {
	cfg := config.FromEnv()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, closeStore, err := room.NewStore(ctx, cfg)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer closeStore()

	hub := room.NewHub(cfg, store)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewServer(cfg, hub, store).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("relay listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	// Graceful shutdown: drain active WebSocket connections so ECS rolling
	// replacements do not drop clients mid-message.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	log.Println("shutting down...")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Println("bye")
}
