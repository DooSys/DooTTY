# Translating DooTTY

DooTTY uses [i18next](https://www.i18next.com/) with ordinary UTF-8 JSON files.
There is no translation server, account or paid service to configure. All catalogs
are bundled with the application and work offline.

## Improve an existing translation

Edit the values in one of these files directly on GitHub and open a pull request:

- [`src/locales/en.json`](src/locales/en.json) — English and fallback reference.
- [`src/locales/fr.json`](src/locales/fr.json) — French.

Keep the keys unchanged. For example:

```json
{
  "management": {
    "restartTitle": "Restart {{distribution}}?"
  }
}
```

Translate the sentence, keeping `{{distribution}}` exactly as written. Variables
may move within a sentence, but their names must not change. Translate complete
sentences; do not assemble translations from fragments.

Keep names such as DooTTY, WSL, Debian and commands such as `wsl.exe` unchanged.
Preserve keyboard combinations while translating key names where appropriate.
Do not add HTML: translations are displayed as plain text. JSON strings use double
quotes; backslashes in example Windows paths must be escaped as `\\`.

## Add a language

1. Copy `src/locales/en.json` to a new locale file, for example `src/locales/de.json`
   or `src/locales/pt-BR.json`.
2. Set `_meta.name` to the language's own name, for example `Deutsch` or
   `Português (Brasil)`.
3. Translate the values, preserving all keys and variables. Keeping a value in
   English while a translation is incomplete is fine.
4. Run the checks below and open a pull request describing the language.

The application discovers the JSON files automatically. The display-language
selector uses `_meta.name`; adding a language does not require changes to the UI,
Rust code, dependencies or tests. File names use a two- or three-letter lowercase
language code, optionally followed by region/script subtags separated by hyphens.

## Validate

For a local checkout with Node.js installed:

```sh
npm ci
npm run check:translations
npm test
```

The translation checker verifies JSON structure, key coverage, placeholders,
metadata and UI key references. CI runs it as well. It does not build or run WSL.

For an interface preview:

```sh
npm run dev
```

Open the local address, then Settings → General → Display language. The browser
preview cannot save the application configuration; testing persistence requires
the Windows application. Maintainers can preview a catalog from the browser
console using `const { setLanguage } = await import('/src/i18n.ts'); await setLanguage('en')`.
This development-only module path is not used in the packaged application.

Check long labels, keyboard navigation, confirmation dialogs and narrow windows.
Do not run operations that interrupt a real distribution just to check wording.

## Scope

The setting changes the DooTTY interface after Save, without restarting terminal
sessions. Existing configurations default to French. An unavailable locale falls
back to English; missing translation keys also fall back to English.

Terminal output, distribution names, commands, filenames and diagnostics returned
by WSL or Windows are kept verbatim. Native Rust diagnostic strings are currently
also kept verbatim (some are French); their structured localization is a separate
follow-up. Brand taglines and sample filenames in the terminal preview are literal.
