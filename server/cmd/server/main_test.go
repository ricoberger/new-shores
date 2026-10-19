package main

import (
	"io"
	"slices"
	"testing"
)

func TestParseFlags(t *testing.T) {
	o, err := parseFlags([]string{"--dev", "--time-scale", "10", "--addr", ":9000"}, io.Discard)
	if err != nil || !o.dev || o.timeScale != 10 || o.addr != ":9000" || o.content != "../content/old_coast" ||
		!slices.Equal(o.corsOrigins, []string{"http://localhost:5173", "http://127.0.0.1:5173"}) {
		t.Fatalf("parseFlags = %+v, %v", o, err)
	}
	for _, args := range [][]string{
		{"--time-scale", "0"},
		{"--time-scale", "-1"},
		{"--time-scale", "NaN"},
		{"--log-format", "xml"},
		{"--unknown"},
		{"extra"},
		{"--cors-origin", "*"},
		{"--cors-origin", "localhost:5173"},
		{"--cors-origin", "http://localhost:5173/"},
		{"--cors-origin", "http://localhost:5173,ftp://x"},
	} {
		if _, err := parseFlags(args, io.Discard); err == nil {
			t.Errorf("parseFlags(%v) succeeded", args)
		}
	}
}

func TestParseOrigins(t *testing.T) {
	o, err := parseFlags([]string{"--cors-origin", " http://localhost:4174 , https://play.example.org "}, io.Discard)
	if err != nil || !slices.Equal(o.corsOrigins, []string{"http://localhost:4174", "https://play.example.org"}) {
		t.Fatalf("origins = %v, %v", o.corsOrigins, err)
	}
}
