package main

import (
	"io"
	"testing"
)

func TestParseFlags(t *testing.T) {
	o, err := parseFlags([]string{"--dev", "--time-scale", "10", "--addr", ":9000"}, io.Discard)
	if err != nil || !o.dev || o.timeScale != 10 || o.addr != ":9000" || o.content != "../content/old_coast" || o.corsOrigin != "http://localhost:5173" {
		t.Fatalf("parseFlags = %+v, %v", o, err)
	}
	for _, args := range [][]string{
		{"--time-scale", "0"},
		{"--time-scale", "-1"},
		{"--time-scale", "NaN"},
		{"--log-format", "xml"},
		{"--unknown"},
		{"extra"},
	} {
		if _, err := parseFlags(args, io.Discard); err == nil {
			t.Errorf("parseFlags(%v) succeeded", args)
		}
	}
}
