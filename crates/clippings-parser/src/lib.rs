//! Pure parser for Kindle `My Clippings.txt` files (S2).
//!
//! Kept dependency-free apart from `serde`/`sha2` so
//! `cargo test -p clippings-parser` runs on any machine without
//! Tauri system dependencies.
//!
//! Design notes:
//! - Entries are separated by a line made only of `=` characters.
//! - The meta line is matched by locale keywords (en/es/de/fr/it/pt),
//!   not by exact format, because real Kindle files vary in wording,
//!   casing and in whether page/location are present.
//! - Dates are normalized to `YYYY-MM-DDTHH:MM:SS` when recognized;
//!   the raw string is always preserved.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// What kind of entry a clipping is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClippingKind {
    Highlight,
    Note,
    Bookmark,
}

impl ClippingKind {
    fn as_str(self) -> &'static str {
        match self {
            ClippingKind::Highlight => "highlight",
            ClippingKind::Note => "note",
            ClippingKind::Bookmark => "bookmark",
        }
    }
}

/// One parsed entry from `My Clippings.txt`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clipping {
    pub title: String,
    pub author: Option<String>,
    pub kind: ClippingKind,
    pub page: Option<u32>,
    /// Raw location token as written by Kindle, e.g. `"234-236"`.
    pub location: Option<String>,
    /// Date string exactly as written by Kindle.
    pub added_on_raw: String,
    /// Normalized `YYYY-MM-DDTHH:MM:SS` when the locale is recognized.
    pub added_on: Option<String>,
    /// `None` for bookmarks and entries without text.
    pub content: Option<String>,
    /// SHA-256 over the normalized fields; used for cross-file dedupe (S5).
    pub content_hash: String,
}

impl Clipping {
    /// Deterministic hash over the normalized entry fields.
    pub fn hash_of(
        title: &str,
        author: Option<&str>,
        kind: ClippingKind,
        page: Option<u32>,
        location: Option<&str>,
        content: Option<&str>,
    ) -> String {
        fn feed(hasher: &mut Sha256, value: &str) {
            hasher.update((value.len() as u64).to_le_bytes());
            hasher.update(value.as_bytes());
            hasher.update([0u8]);
        }

        let mut hasher = Sha256::new();
        feed(&mut hasher, &title.trim().to_lowercase());
        feed(&mut hasher, &author.unwrap_or("").trim().to_lowercase());
        feed(&mut hasher, kind.as_str());
        feed(
            &mut hasher,
            &page.map(|p| p.to_string()).unwrap_or_default(),
        );
        feed(&mut hasher, location.unwrap_or("").trim());
        let normalized_content = content
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        feed(&mut hasher, &normalized_content);
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// Decode raw file bytes, auto-detecting UTF-8 and UTF-16 (LE/BE, with BOM).
pub fn decode_bytes(bytes: &[u8]) -> String {
    if let Some(stripped) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16_to_string(stripped, false);
    }
    if let Some(stripped) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16_to_string(stripped, true);
    }
    if let Some(stripped) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(stripped).into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.strip_prefix('\u{FEFF}').unwrap_or(text).to_string(),
        Err(_) => {
            // No BOM and not valid UTF-8: most likely UTF-16LE without BOM.
            // Only trust it if the decoded text looks like clippings.
            if bytes.len().is_multiple_of(2) {
                let candidate = utf16_to_string(bytes, false);
                if candidate.contains("==========") {
                    return candidate;
                }
            }
            String::from_utf8_lossy(bytes).into_owned()
        }
    }
}

fn utf16_to_string(bytes: &[u8], big_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if big_endian {
                u16::from_be_bytes([pair[0], pair[1]])
            } else {
                u16::from_le_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    let text = String::from_utf16_lossy(&units);
    text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string()
}

/// Parse outcome: the accepted clippings plus how many blocks were discarded.
#[derive(Debug)]
pub struct ParseResult {
    pub clippings: Vec<Clipping>,
    pub skipped: usize,
}

/// Parse decoded `My Clippings.txt` text into individual clippings.
/// Malformed entries (no title, no meta line, unknown kind) are skipped.
pub fn parse_clippings(text: &str) -> Vec<Clipping> {
    parse_clippings_with_stats(text).clippings
}

/// Same parse as [`parse_clippings`], also counting the blocks it rejects.
///
/// Only a block with at least one non-blank line can be "skipped": the line
/// loop flushes on every `==========`, including the synthetic trailing
/// sentinel, so counting every rejected block would report a phantom skip
/// on every clean file.
pub fn parse_clippings_with_stats(text: &str) -> ParseResult {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut clippings = Vec::new();
    let mut skipped = 0usize;
    let mut block: Vec<&str> = Vec::new();

    for line in normalized.lines().chain(std::iter::once("==========")) {
        let trimmed = line.trim();
        if !trimmed.is_empty() && trimmed.chars().all(|c| c == '=') {
            match parse_block(&block) {
                Some(clipping) => clippings.push(clipping),
                None => {
                    if block.iter().any(|line| !clean_line(line).is_empty()) {
                        skipped += 1;
                    }
                }
            }
            block.clear();
        } else {
            block.push(line);
        }
    }
    ParseResult { clippings, skipped }
}

fn parse_block(block: &[&str]) -> Option<Clipping> {
    let mut lines = block
        .iter()
        .map(|line| clean_line(line))
        .filter(|line| !line.is_empty());
    let title_line = lines.next()?;
    let meta_line = lines.next()?;
    if !meta_line.trim_start().starts_with('-') {
        return None;
    }
    let content = {
        let joined = lines.collect::<Vec<_>>().join("\n").trim().to_string();
        if joined.is_empty() {
            None
        } else {
            Some(joined)
        }
    };

    let (title, author) = parse_title_author(title_line);
    let (kind, page, location, added_on_raw) = parse_meta(meta_line)?;
    let added_on = normalize_date(&added_on_raw);
    let content_hash = Clipping::hash_of(
        &title,
        author.as_deref(),
        kind,
        page,
        location.as_deref(),
        content.as_deref(),
    );
    Some(Clipping {
        title,
        author,
        kind,
        page,
        location,
        added_on_raw,
        added_on,
        content,
        content_hash,
    })
}

/// Trim a raw line and drop a stray U+FEFF. Kindle files can embed a
/// byte-order mark not only at the start of the file but also at the
/// start of entries mid-file; left in place it would corrupt titles
/// (splitting one book into two) and break meta-line matching.
fn clean_line(line: &str) -> &str {
    let trimmed = line.trim();
    trimmed.strip_prefix('\u{FEFF}').unwrap_or(trimmed).trim()
}

/// Split `"Title (Author)"` on the LAST parenthesized suffix.
fn parse_title_author(line: &str) -> (String, Option<String>) {
    let line = line.trim();
    if line.ends_with(')') {
        if let Some(idx) = line.rfind(" (") {
            let title = line[..idx].trim().to_string();
            let author = line[idx + 2..line.len() - 1].trim().to_string();
            if !title.is_empty() && !author.is_empty() {
                return (title, Some(author));
            }
        }
    }
    (line.to_string(), None)
}

fn parse_meta(meta: &str) -> Option<(ClippingKind, Option<u32>, Option<String>, String)> {
    let lower = meta.to_lowercase();
    let kind = detect_kind(&lower)?;
    let page = ["página", "pagina", "seite", "page"]
        .iter()
        .filter_map(|keyword| number_after(&lower, keyword))
        .next();
    let location = [
        "emplacement",
        "posizione",
        "posición",
        "posicion",
        "posição",
        "posicao",
        "location",
        "position",
    ]
    .iter()
    .filter_map(|keyword| token_after(&lower, keyword))
    .next();
    let added_on_raw = [
        "added on",
        "añadido el",
        "hinzugefügt am",
        "ajouté le",
        "ajoutée le",
        "aggiunto il",
        "adicionado em",
        "adicionada em",
    ]
    .iter()
    .filter_map(|marker| rest_after(meta, &lower, marker))
    .next()
    .unwrap_or_default();
    Some((kind, page, location, added_on_raw))
}

fn detect_kind(lower_meta: &str) -> Option<ClippingKind> {
    const BOOKMARK: &[&str] = &[
        "bookmark",
        "marcador",
        "lesezeichen",
        "signet",
        "segnalibro",
    ];
    const NOTE: &[&str] = &["note", "nota", "notiz"];
    const HIGHLIGHT: &[&str] = &[
        "highlight",
        "subrayado",
        "resaltado",
        "markierung",
        "surlign",
        "evidenzia",
        "destaque",
    ];
    if BOOKMARK.iter().any(|w| lower_meta.contains(w)) {
        return Some(ClippingKind::Bookmark);
    }
    if NOTE.iter().any(|w| lower_meta.contains(w)) {
        return Some(ClippingKind::Note);
    }
    if HIGHLIGHT.iter().any(|w| lower_meta.contains(w)) {
        return Some(ClippingKind::Highlight);
    }
    None
}

/// First `u32` found after `keyword` (e.g. page number).
fn number_after(haystack: &str, keyword: &str) -> Option<u32> {
    let idx = haystack.find(keyword)?;
    haystack[idx + keyword.len()..]
        .split(|c: char| !c.is_ascii_digit())
        .find(|part| !part.is_empty())?
        .parse()
        .ok()
}

/// First location token (`"234-236"` or `"236"`) found after `keyword`.
fn token_after(haystack: &str, keyword: &str) -> Option<String> {
    let idx = haystack.find(keyword)?;
    let token: String = haystack[idx + keyword.len()..]
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    let token = token.trim_matches('-').to_string();
    if token.is_empty() || !token.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(token)
}

/// Raw date text after the locale's "added on" marker, preserving case.
///
/// Char-boundary safe: lowercasing can change byte length for exotic
/// characters, so the byte index found in the lowercased string is mapped
/// back to the original through char counts instead of reused directly.
fn rest_after(original: &str, lower: &str, marker: &str) -> Option<String> {
    let idx = lower.find(marker)?;
    let skipped_chars = lower[..idx].chars().count();
    let mut byte_idx = original
        .char_indices()
        .nth(skipped_chars)
        .map(|(i, _)| i)
        .unwrap_or(original.len());
    for _ in 0..marker.chars().count() {
        byte_idx += original.get(byte_idx..)?.chars().next()?.len_utf8();
    }
    Some(original.get(byte_idx..)?.trim().to_string())
}

/// (month name, month number) across supported Kindle locales.
const MONTHS: &[(&str, u32)] = &[
    ("january", 1),
    ("february", 2),
    ("march", 3),
    ("april", 4),
    ("may", 5),
    ("june", 6),
    ("july", 7),
    ("august", 8),
    ("september", 9),
    ("october", 10),
    ("november", 11),
    ("december", 12),
    ("enero", 1),
    ("febrero", 2),
    ("marzo", 3),
    ("abril", 4),
    ("mayo", 5),
    ("junio", 6),
    ("julio", 7),
    ("agosto", 8),
    ("septiembre", 9),
    ("octubre", 10),
    ("noviembre", 11),
    ("diciembre", 12),
    ("januar", 1),
    ("februar", 2),
    ("märz", 3),
    ("marz", 3),
    ("april", 4),
    ("mai", 5),
    ("juni", 6),
    ("juli", 7),
    ("august", 8),
    ("september", 9),
    ("oktober", 10),
    ("november", 11),
    ("dezember", 12),
    ("janvier", 1),
    ("février", 2),
    ("fevrier", 2),
    ("mars", 3),
    ("avril", 4),
    ("mai", 5),
    ("juin", 6),
    ("juillet", 7),
    ("août", 8),
    ("aout", 8),
    ("septembre", 9),
    ("octobre", 10),
    ("novembre", 11),
    ("décembre", 12),
    ("decembre", 12),
    ("gennaio", 1),
    ("febbraio", 2),
    ("marzo", 3),
    ("aprile", 4),
    ("maggio", 5),
    ("giugno", 6),
    ("luglio", 7),
    ("agosto", 8),
    ("settembre", 9),
    ("ottobre", 10),
    ("novembre", 11),
    ("dicembre", 12),
    ("janeiro", 1),
    ("fevereiro", 2),
    ("março", 3),
    ("marco", 3),
    ("abril", 4),
    ("maio", 5),
    ("junho", 6),
    ("julho", 7),
    ("agosto", 8),
    ("setembro", 9),
    ("outubro", 10),
    ("novembro", 11),
    ("dezembro", 12),
];

/// Normalize a Kindle date to `YYYY-MM-DDTHH:MM:SS`; `None` if unrecognized.
fn normalize_date(raw: &str) -> Option<String> {
    let lower = raw.to_lowercase();
    // Longest names first so e.g. "marzo" wins over any shorter overlap.
    let mut names: Vec<(&str, u32)> = MONTHS.to_vec();
    names.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));
    let (month, month_pos) = names
        .iter()
        .filter_map(|(name, m)| lower.find(name).map(|pos| (*m, pos)))
        .next()?;

    let numbers = integer_tokens(&lower);
    let year = numbers
        .iter()
        .find(|(value, _)| (1900..=2100).contains(value))
        .map(|(value, _)| *value)?;
    let day = numbers
        .iter()
        .filter(|(value, _)| (1..=31).contains(value))
        .rev()
        .find(|(_, pos)| *pos < month_pos)
        .or_else(|| {
            numbers
                .iter()
                .filter(|(value, _)| (1..=31).contains(value))
                .find(|(_, pos)| *pos > month_pos)
        })
        .map(|(value, _)| *value)?;

    let (hour, minute, second) = time_token(&lower)?;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}"
    ))
}

/// All integer tokens with their byte positions.
fn integer_tokens(text: &str) -> Vec<(i32, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (idx, ch) in text.char_indices() {
        if ch.is_ascii_digit() {
            if start.is_none() {
                start = Some(idx);
            }
        } else if let Some(s) = start.take() {
            if let Ok(value) = text[s..idx].parse() {
                out.push((value, s));
            }
        }
    }
    if let Some(s) = start {
        if let Ok(value) = text[s..].parse() {
            out.push((value, s));
        }
    }
    out
}

/// First `HH:MM:SS` token plus optional AM/PM marker.
fn time_token(text: &str) -> Option<(u32, u32, u32)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    for (i, word) in words.iter().enumerate() {
        let clean = word.trim_matches(|c: char| !c.is_ascii_digit() && c != ':');
        let parts: Vec<&str> = clean.split(':').collect();
        if parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        {
            let mut hour: u32 = parts[0].parse().ok()?;
            let minute: u32 = parts[1].parse().ok()?;
            let second: u32 = parts[2].parse().ok()?;
            if hour > 23 || minute > 59 || second > 59 {
                continue;
            }
            if let Some(next) = words.get(i + 1) {
                match next.trim_matches('.') {
                    "pm" | "p" => {
                        if hour < 12 {
                            hour += 12;
                        }
                    }
                    "am" | "a" => {
                        if hour == 12 {
                            hour = 0;
                        }
                    }
                    _ => {}
                }
            }
            return Some((hour, minute, second));
        }
    }
    None
}
