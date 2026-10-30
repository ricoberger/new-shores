package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func contentDirs(t *testing.T) map[string]string {
	t.Helper()
	root := repoRoot(t)
	return map[string]string{
		"old_coast":         filepath.Join(root, "content", "old_coast"),
		"old_coast_dairy":   filepath.Join(root, "server", "testdata", "content", "old_coast_dairy"),
		"old_coast_variety": filepath.Join(root, "server", "testdata", "content", "old_coast_variety"),
		"pre_d054":          filepath.Join(root, "server", "testdata", "content", "old_coast_pre_d054"),
	}
}

// TestLocalesComplete loads the shipped content and the test contents: a
// language with a locale file is complete (no missing, no unknown key).
func TestLocalesComplete(t *testing.T) {
	for name, dir := range contentDirs(t) {
		t.Run(name, func(t *testing.T) {
			c, err := LoadWithSchemas(dir, filepath.Join(repoRoot(t), "content", "schema"))
			if err != nil {
				t.Fatal(err)
			}
			for lang, texts := range c.Locales {
				if len(texts) != len(c.Texts()) {
					t.Errorf("%s: %d texts for %d keys", lang, len(texts), len(c.Texts()))
				}
			}
		})
	}
}

func TestShippedLanguages(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	langs := c.Languages()
	if len(langs) < 2 || langs[0] != "en" || langs[1] != "de" {
		t.Fatalf("Languages() = %v, want [en de ...]", langs)
	}
	if got := c.Translate("de", "buildings.lumberjack.name", "Lumberjack"); got != "Holzfäller" {
		t.Errorf("de lumberjack = %q", got)
	}
	if got := c.Translate("en", "buildings.lumberjack.name", "Lumberjack"); got != "Lumberjack" {
		t.Errorf("en lumberjack = %q", got)
	}
	if !c.HasLanguage("en") || !c.HasLanguage("de") || c.HasLanguage("fr") {
		t.Error("HasLanguage")
	}
	seen := map[string]bool{}
	for _, tx := range c.Texts() {
		if seen[tx.Key] {
			t.Errorf("duplicate key %s", tx.Key)
		}
		seen[tx.Key] = true
	}
	for _, k := range []string{"region.old_coast.name", "buildings.lumberjack.name", "quests.intro_home_island.text", "islands.large.name", "island_names.12"} {
		if !seen[k] {
			t.Errorf("missing key %s", k)
		}
	}
}

// TestLocaleErrors: a missing key, an unknown key, a bad language file name
// and an English locale file are content errors.
func TestLocaleErrors(t *testing.T) {
	root := repoRoot(t)
	de, err := os.ReadFile(filepath.Join(root, "content", "old_coast", DirI18n, "de.json")) // #nosec G304 -- test fixture path.
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, file, data string
		want             []string
	}{
		{"missing key", "de.json", strings.Replace(string(de), `"buildings.lumberjack.name": "Holzfäller",`, "", 1), []string{"de.json", "buildings.lumberjack.name", "missing translation"}},
		{"unknown key", "de.json", strings.Replace(string(de), "{\n", "{\n  \"buildings.nope.name\": \"x\",\n", 1), []string{"buildings.nope.name", "unknown key"}},
		{"bad key shape", "de.json", strings.Replace(string(de), "{\n", "{\n  \"Nope\": \"x\",\n", 1), []string{"de.json", "schema violation"}},
		{"too long name", "de.json", strings.Replace(string(de), `"Holzfäller"`, `"`+strings.Repeat("x", 33)+`"`, 1), []string{"buildings.lumberjack.name", "1 to 32"}},
		{"english file", "en.json", string(de), []string{"en.json", "no locale file"}},
		{"bad file name", "DE.json", string(de), []string{"DE.json", "two or three letter"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, FileStart)
			if err := os.MkdirAll(filepath.Join(dir, DirI18n), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, DirI18n, tt.file), []byte(tt.data), 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := LoadWithSchemas(dir, filepath.Join(root, "content", "schema"))
			if err == nil {
				t.Fatal("expected an error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
		})
	}
}
