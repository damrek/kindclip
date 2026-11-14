# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries describe user-visible behavior. CI, refactors, tests and tooling are not
listed. History before v1.0.0 is left to the release list.

## [Unreleased]

### Changed

- **Preferences**: the dialog no longer scrolls at the minimum window size.
  Language and text size share a row, the palette cards are slimmer, and keyboard
  shortcuts moved to a header icon, retiring the one-item About section. Data
  actions now use short labels with the full description on hover, Diagnostics
  reads "Open logs", and the privacy note fits on one line.

## [1.19.0] - 2026-11-13

### Added

- **Searchable author and tag filters**: the author and tag lists in the Filters
  menu get their own search, accent- and case-insensitive (a leading `#` is
  optional for tags), and scroll inside a five-row window with a bottom fade
  instead of one long checkbox wall. Section headers carry a count pill, and the
  search and end-of-list state reset when the menu closes.

### Changed

- **Sidebar by author**: authors read as a label — small, uppercase, tracked —
  with the book and clipping counts underneath, and their books sit behind a
  left rail, so each group reads as one author with its titles instead of a flat
  list of rows.
- **Preferences**: the Data section lays out in two columns, and the running
  version moved out of the dialog to the top bar, beside the settings button.

### Fixed

- Counts follow each language's plural rules, so no locale renders “1 clippings”
  anymore.
- Re-importing after an interrupted import converges instead of leaving book
  clipping counts behind.
- **Open database location** keeps Preferences open and reports a failure in the
  dialog. It used to close the dialog, and the error was only visible in the
  status bar behind it.

## [1.18.0] - 2026-11-12

### Added

- **Author filter and grouped sidebar**: filter clippings by one or more authors —
  including an explicit unknown-author entry — with counts, removable chips and
  Clear all. The sidebar switches between the flat book list and collapsible
  author groups, remembers the choice and expands or collapses every group at
  once.
- **Daily backups**: once per launch, unless turned off in Preferences → Data,
  kindclip snapshots the database into a `backups/` folder next to it, keeps the
  newest 7 and lists them in the restore dialog. A manual backup saved there
  counts as the day's snapshot.
- **Obsidian export**: write the filtered view as one Markdown file per book into
  a folder you choose, with YAML frontmatter (title, author, tags, clipping
  count, export date), an overwrite confirmation and atomic writes.

### Fixed

- Long book titles no longer break per-book export file names, and export logs
  never record file names.
- Automatic backups sweep temporary files left by an interrupted launch and
  never delete a file they do not own.

## [1.17.0] - 2026-11-11

### Added

- **Copy as quote**: any highlight or note copies to the clipboard as a Markdown
  blockquote citing author, book title and page — or position when the page is
  unknown. Available from the card (`❝`), the reading view, and `q` from the
  keyboard.
- **Landing page** at [damrek.github.io/kindclip](https://damrek.github.io/kindclip/):
  feature grid, the five themes rendered as live clipping cards, per-platform
  install steps and an FAQ. No JavaScript, no build step.

## [1.16.0] - 2026-11-11

### Added

- **Global palette** (`Ctrl/Cmd+P`): search every clipping across all books and
  filters, newest first. `Enter` or `o` opens the reading view over the results,
  arrows and `j`/`k` move the selection, `Esc` closes one layer.
- The palette footer shows `{shown} of {total}`, counted with the same query that
  produces the rows.
- Scrollable lists fade at the bottom edge and dissolve once the end is reached.

### Changed

- Fresh screenshots: the library view in the intro and the palette in a
  collapsible block.

## [1.15.0] - 2026-11-09

### Added

- **Preferences dialog** (`Ctrl/Cmd+,`): language, theme, text size, database
  location, logs folder and shortcuts in one place.
- **Four dark palettes** — Atom One Dark, Darcula, Nord and Solarized Dark —
  chosen independently from light/dark.
- Grouped chrome: the top bar keeps only the sidebar toggle and the settings
  gear; search, filters, sort and export sit above the list they act on.

### Fixed

- Search marks, text selection and focus rings reach WCAG AA (4.5:1) in all five
  themes.

## [1.14.0] - 2026-11-07

### Added

- **Remembered window**: size, position and maximized state are restored on
  launch, and the window only appears once that state is applied.
- **Diagnostic logs** (Preferences → Diagnostics): rotating local files record
  startup, import, export, backup and restore outcomes — paths, counts, sizes and
  errors only, never clipping text or notes.

## [1.13.0] - 2026-11-05

### Added

- **Reading stats** in the sidebar footer: library-wide totals plus clippings per
  year, kind and top book, with undated clippings grouped as "no date".
- **Drag and drop import**: drop a `.txt` anywhere on the window — same parse,
  dedupe and progress report as the Import button.

## [1.12.0] - 2026-11-03

### Added

- **Backup and restore** (Preferences → Data): save a consistent snapshot of
  `kindclip.db`; restores verify the file is real SQLite with the kindclip
  tables, preview its contents, keep the replaced database as
  `kindclip.db.before-restore`, and refuse a snapshot from a newer schema.
- **Keyboard-first**: `?` opens the shortcut sheet; `/`, `Ctrl/Cmd+K` and
  `Ctrl/Cmd+F` focus search; `j`/`k` select, `Enter`/`o` open, `*` favorites,
  `c` copies, `s`/`f` toggle sidebar and filters, `n`/`p` page, and `Esc`
  closes one layer at a time.

## [1.11.0] - 2026-11-02

### Added

- **Multi-word search**: every word must match across content, title and author,
  accent- and case-insensitively, with hits highlighted in the list and the
  reading view.

### Fixed

- The stored filter is applied before the first load, so startup no longer
  flashes the wrong rows.
- The reading view keeps its own filter and restores focus when closed.

## [1.10.0] - 2026-10-31

### Added

- **Reading view**: any clipping opens full-window (`⤢`), ←/→ steps through the
  filtered list, and `Esc` closes it while keeping your place.

## [1.9.0] - 2026-10-30

### Added

- Import reports skipped entries end to end, with counts and reasons instead of
  failing silently.
- The app version is shown in the preferences menu.

### Fixed

- Search matches accented and unaccented text alike.
- Import batches inserts with per-row placeholders, keeping large files fast and
  consistent.

## [1.8.0] - 2026-10-28

### Added

- Click a card's kind or **Edited** badge to filter the library by it.

## [1.7.0] - 2026-10-26

### Added

- Filter books by title or author.

## [1.6.0] - 2026-10-25

### Added

- Tags on clipping cards are clickable: one click filters the library by that
  tag.

## [1.5.0] - 2026-10-24

### Added

- Grouped app chrome, and a collapsible shell whose state is remembered.

## [1.4.0] - 2026-10-23

### Added

- **Tags**: free-form per clipping, inline add and remove with suggestions,
  filtering by any number of tags (AND), and rename, merge or delete in
  **Library → Tags**.
- Tags travel with every export format.

### Fixed

- Merged tags no longer linger in the active filter.

## [1.3.0] - 2026-10-22

### Added

- **Library management dialog**: list imports, rename or merge books, delete a
  book, and undo one import.

## [1.2.0] - 2026-10-21

### Added

- Sort clippings by newest/oldest, book title (A–Z/Z–A) or page; the choice
  persists.

## [1.1.0] - 2026-10-20

### Added

- Sort books by title or author (↑/↓), persisted.

## [1.0.0] - 2026-10-16

### Added

- **Export** the filtered view to Markdown, JSON or CSV as one file grouped by
  book. Markdown labels follow the app language; JSON and CSV keep stable English
  fields for scripting.
