// Command replay-plan generates a reference game from its plan (D-067).
//
//	replay-plan -plan server/testdata/plans/bootstrap_citizens.plan.json \
//	            -out server/testdata/scenarios/bootstrap_citizens.json
//	replay-plan -plan ... -out ... -check   regenerates and exits 1 when
//	                                        the file differs
//
// The plan's content path is resolved against the repository root (-root,
// default: the nearest ancestor of the working directory with a content
// directory).
package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/pprof"

	"github.com/ricoberger/new-shores/server/internal/sim/scenario/plan"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "replay-plan:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("replay-plan", flag.ContinueOnError)
	fs.SetOutput(stderr)
	planPath := fs.String("plan", "", "plan file (required)")
	out := fs.String("out", "", "scenario file to write (required)")
	check := fs.Bool("check", false, "regenerate and compare with -out instead of writing it")
	root := fs.String("root", "", "repository root (default: nearest ancestor with a content directory)")
	verbose := fs.Bool("v", false, "log the generator's progress")
	cpuProfile := fs.String("cpuprofile", "", "write a CPU profile of the generator to this file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *cpuProfile != "" {
		f, err := os.Create(*cpuProfile)
		if err != nil {
			return err
		}
		defer f.Close()
		if err := pprof.StartCPUProfile(f); err != nil {
			return err
		}
		defer pprof.StopCPUProfile()
	}
	if *planPath == "" || *out == "" {
		fs.Usage()
		return errors.New("-plan and -out are required")
	}
	if *root == "" {
		r, err := findRoot()
		if err != nil {
			return err
		}
		*root = r
	}
	var log io.Writer
	if *verbose {
		log = stderr
	}
	s, err := plan.Generate(*planPath, *root, log)
	if err != nil {
		if s != nil && *verbose {
			// The steps generated before the failure, for diagnosis.
			if data, merr := plan.Marshal(s); merr == nil && os.WriteFile(*out+".partial", data, 0o600) == nil {
				fmt.Fprintf(stderr, "wrote %s.partial (%d steps)\n", *out, len(s.Steps))
			}
		}
		return err
	}
	data, err := plan.Marshal(s)
	if err != nil {
		return err
	}
	if *check {
		have, err := os.ReadFile(*out)
		if err != nil {
			return err
		}
		if !bytes.Equal(have, data) {
			return fmt.Errorf("%s differs from the output of %s; run replay-plan without -check", *out, *planPath)
		}
		fmt.Fprintf(stdout, "%s matches %s (%d steps)\n", *out, *planPath, len(s.Steps))
		return nil
	}
	if err := os.WriteFile(*out, data, 0o600); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "wrote %s (%d steps)\n", *out, len(s.Steps))
	return nil
}

// findRoot returns the nearest ancestor of the working directory that
// holds a content directory.
func findRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if st, err := os.Stat(filepath.Join(dir, "content")); err == nil && st.IsDir() {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no repository root with a content directory above the working directory; set -root")
		}
		dir = parent
	}
}
