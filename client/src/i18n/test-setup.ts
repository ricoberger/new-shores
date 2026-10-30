// Vitest setup: tests run in English whatever the machine's locale (D-061).
import { setLanguage } from "./index";

setLanguage("en", false);
