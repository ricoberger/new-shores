package content

import (
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Content locale files (D-061): the main JSON files are the English source;
// content/<region>/i18n/<lang>.json is a flat map from text key to the
// translated text. Key format "<file>.<id>.<field>" (for example
// "buildings.lumberjack.name", "quests.q01.text"); a list entry has
// "<file>.<index>" ("island_names.12", zero-based).

// DirI18n is the locale directory inside a region directory.
const DirI18n = "i18n"

// SourceLanguage is the language of the main content files.
const SourceLanguage = "en"

// Limits of translated texts (the English source limits, applied to every
// language so a translation never overflows the UI the source fits).
const maxTextRunes = 2000

var langPattern = regexp.MustCompile(`^[a-z]{2,3}$`)

// Text is one translatable content text: its key and English source.
type Text struct {
	Key  string
	Text string
}

// TextKey builds the key of a text: file name without extension, entity ID
// and field.
func TextKey(file, id, field string) string { return file + "." + id + "." + field }

// IslandNameKey is the key of the i-th entry of the island name list.
func IslandNameKey(i int) string { return fmt.Sprintf("island_names.%d", i) }

// Fixed key prefixes (content file names without extension).
const (
	keyRegion         = "region"
	keyTiers          = "tiers"
	keyGoods          = "goods"
	keyBuildings      = "buildings"
	keyNeeds          = "needs"
	keyNeedCategories = "need_categories"
	keyShips          = "ships"
	keyQuests         = "quests"
	keyIslands        = "islands"
)

// Texts lists every translatable text of the catalogue in content order:
// region, tier, good, building, need category, need and ship names, quest
// titles and texts, island size class names and the island name list.
func (c *Catalogue) Texts() []Text {
	var out []Text
	add := func(file, id, field, text string) { out = append(out, Text{TextKey(file, id, field), text}) }
	add(keyRegion, c.Region.ID, "name", c.Region.Name)
	for _, t := range c.Tiers {
		add(keyTiers, t.ID, "name", t.Name)
	}
	for _, g := range c.Goods {
		add(keyGoods, g.ID, "name", g.Name)
	}
	for _, b := range c.Buildings {
		add(keyBuildings, b.ID, "name", b.Name)
	}
	for _, nc := range c.NeedCategories {
		add(keyNeedCategories, nc.ID, "name", nc.Name)
	}
	for _, tier := range c.Tiers {
		for _, n := range c.NeedsByTier[tier.ID] {
			add(keyNeeds, n.ID, "name", n.Name)
		}
	}
	for _, s := range c.Ships {
		add(keyShips, s.ID, "name", s.Name)
	}
	for _, q := range c.Quests {
		add(keyQuests, q.ID, "title", q.Title)
		add(keyQuests, q.ID, "text", q.Text)
	}
	for _, sc := range c.Islands.SizeClasses {
		add(keyIslands, sc.ID, "name", sc.Name)
	}
	for i, n := range c.IslandNames {
		out = append(out, Text{IslandNameKey(i), n})
	}
	return out
}

// Languages returns the shipped languages: "en" first, then the locale
// files in alphabetical order.
func (c *Catalogue) Languages() []string {
	langs := []string{SourceLanguage}
	return append(langs, slices.Sorted(maps.Keys(c.Locales))...)
}

// HasLanguage reports whether lang is a shipped language.
func (c *Catalogue) HasLanguage(lang string) bool {
	if lang == SourceLanguage {
		return true
	}
	_, ok := c.Locales[lang]
	return ok
}

// Translate returns the text of key in lang, or english when the language
// is the source or the key has no translation (completeness is checked at
// load, so the fallback only covers unknown languages).
func (c *Catalogue) Translate(lang, key, english string) string {
	if t, ok := c.Locales[lang][key]; ok {
		return t
	}
	return english
}

// loadLocales reads dir/i18n/<lang>.json (if the directory exists),
// validates each file against locale.schema.json and checks completeness.
func loadLocales(c *Catalogue, dir, schemaDir string) error {
	i18nDir := filepath.Join(dir, DirI18n)
	entries, err := os.ReadDir(i18nDir) // #nosec G304 -- content paths come from trusted configuration.
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("content: %w", err)
	}
	var errs []error
	sources := c.Texts()
	known := make(map[string]string, len(sources))
	for _, s := range sources {
		known[s.Key] = s.Text
	}
	c.Locales = map[string]map[string]string{}
	for _, e := range entries {
		file := DirI18n + "/" + e.Name()
		lang, ok := strings.CutSuffix(e.Name(), ".json")
		if e.IsDir() || !ok || !langPattern.MatchString(lang) {
			errs = append(errs, &Error{File: file, Msg: "locale files are named <lang>.json with a two or three letter language code"})
			continue
		}
		if lang == SourceLanguage {
			errs = append(errs, &Error{File: file, Msg: "English is the source language of the main content files and has no locale file"})
			continue
		}
		data, err := os.ReadFile(filepath.Join(i18nDir, e.Name())) // #nosec G304 -- content paths come from trusted configuration.
		if err != nil {
			return fmt.Errorf("content: %w", err)
		}
		if err := validateSchemaAs(schemaDir, "locale.schema.json", file, data); err != nil {
			errs = append(errs, err)
			continue
		}
		var texts map[string]string
		if err := unmarshal(data, &texts); err != nil {
			errs = append(errs, &Error{File: file, Msg: fmt.Sprintf("decode: %v", err)})
			continue
		}
		errs = append(errs, checkLocale(file, texts, sources, known)...)
		c.Locales[lang] = texts
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

// checkLocale reports missing keys, unknown keys and texts that break the
// limits of their field.
func checkLocale(file string, texts map[string]string, sources []Text, known map[string]string) []error {
	var errs []error
	for _, s := range sources {
		if _, ok := texts[s.Key]; !ok {
			errs = append(errs, &Error{File: file, Entity: s.Key, Msg: "missing translation"})
		}
	}
	for _, key := range slices.Sorted(maps.Keys(texts)) {
		if _, ok := known[key]; !ok {
			errs = append(errs, &Error{File: file, Entity: key, Msg: "unknown key"})
			continue
		}
		if err := checkTranslation(key, texts[key]); err != nil {
			errs = append(errs, &Error{File: file, Entity: key, Msg: err.Error()})
		}
	}
	return errs
}

func checkTranslation(key, text string) error {
	switch {
	case strings.HasPrefix(key, "island_names."):
		return CheckIslandName(text)
	case strings.HasSuffix(key, ".name"):
		return checkName(text, maxNameRunes)
	}
	if !utf8.ValidString(text) || strings.TrimSpace(text) != text {
		return fmt.Errorf("text must be valid UTF-8 without leading or trailing white space")
	}
	n := 0
	for _, r := range text {
		n++
		if !unicode.IsPrint(r) {
			return fmt.Errorf("text contains a non-printable character")
		}
	}
	if n < 1 || n > maxTextRunes {
		return fmt.Errorf("text must have 1 to %d characters", maxTextRunes)
	}
	return nil
}
