use clippings_parser::{decode_bytes, parse_clippings, Clipping, ClippingKind};

fn en_text() -> String {
    include_str!("fixtures/en.txt").to_string()
}

#[test]
fn parses_english_file() {
    let clips = parse_clippings(&en_text());
    assert_eq!(clips.len(), 6);

    let first = &clips[0];
    assert_eq!(first.title, "The Pragmatic Programmer");
    assert_eq!(first.author.as_deref(), Some("David Thomas"));
    assert_eq!(first.kind, ClippingKind::Highlight);
    assert_eq!(first.page, Some(12));
    assert_eq!(first.location.as_deref(), Some("234-236"));
    assert_eq!(first.added_on.as_deref(), Some("2020-01-06T10:15:00"));
    assert_eq!(
        first.content.as_deref(),
        Some("It is not the code that matters, it is the behavior.")
    );

    let note = &clips[1];
    assert_eq!(note.kind, ClippingKind::Note);
    assert_eq!(note.added_on.as_deref(), Some("2020-01-06T10:16:00"));

    let bookmark = &clips[2];
    assert_eq!(bookmark.kind, ClippingKind::Bookmark);
    assert_eq!(bookmark.content, None);

    let location_only = &clips[3];
    assert_eq!(location_only.page, None);
    assert_eq!(location_only.location.as_deref(), Some("100-101"));

    let parens_title = &clips[4];
    assert_eq!(parens_title.title, "Refactoring (2nd Edition)");
    assert_eq!(parens_title.author.as_deref(), Some("Martin Fowler"));
    // 11:30 PM -> 23:30
    assert_eq!(
        parens_title.added_on.as_deref(),
        Some("2020-01-09T23:30:00")
    );

    let no_author = &clips[5];
    assert_eq!(no_author.title, "Anonymous Notes");
    assert_eq!(no_author.author, None);
}

#[test]
fn parses_spanish_file() {
    let clips = parse_clippings(include_str!("fixtures/es.txt"));
    assert_eq!(clips.len(), 2);

    let first = &clips[0];
    assert_eq!(first.title, "El nombre del viento");
    assert_eq!(first.author.as_deref(), Some("Patrick Rothfuss"));
    assert_eq!(first.kind, ClippingKind::Highlight);
    assert_eq!(first.page, Some(45));
    assert_eq!(first.location.as_deref(), Some("678-680"));
    assert_eq!(first.added_on.as_deref(), Some("2020-01-06T10:15:00"));

    let note = &clips[1];
    assert_eq!(note.kind, ClippingKind::Note);
    assert_eq!(note.content.as_deref(), Some("Releer este capítulo."));
}

#[test]
fn parses_other_locale_dates() {
    let cases = [
        (
            "Die Verwandlung (Franz Kafka)\n- Ihre Markierung auf Seite 10 | Position 100-102 | Hinzugefügt am Montag, 6. Januar 2020 10:15:00\n\nInhalt hier.\n==========\n",
            "2020-01-06T10:15:00",
            ClippingKind::Highlight,
        ),
        (
            "Le Petit Prince (Antoine de Saint-Exupéry)\n- Votre surlignage à la page 5 | Emplacement 50-52 | Ajouté le lundi 6 janvier 2020 10:15:00\n\nContenu ici.\n==========\n",
            "2020-01-06T10:15:00",
            ClippingKind::Highlight,
        ),
        (
            "Il nome della rosa (Umberto Eco)\n- La tua evidenziazione a pagina 20 | Posizione 200-202 | Aggiunto il lunedì 6 gennaio 2020 10:15:00\n\nContenuto qui.\n==========\n",
            "2020-01-06T10:15:00",
            ClippingKind::Highlight,
        ),
        (
            "Dom Casmurro (Machado de Assis)\n- Seu destaque na página 30 | posição 300-302 | Adicionado em segunda-feira, 6 de janeiro de 2020 10:15:00\n\nConteúdo aqui.\n==========\n",
            "2020-01-06T10:15:00",
            ClippingKind::Highlight,
        ),
    ];
    for (text, expected_date, expected_kind) in cases {
        let clips = parse_clippings(text);
        assert_eq!(clips.len(), 1, "for {text:?}");
        assert_eq!(clips[0].added_on.as_deref(), Some(expected_date));
        assert_eq!(clips[0].kind, expected_kind);
    }
}

#[test]
fn decodes_utf16le_with_bom() {
    let original = en_text();
    let mut bytes = vec![0xFF, 0xFE]; // UTF-16LE BOM
    for unit in original.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let decoded = decode_bytes(&bytes);
    assert_eq!(decoded, original);

    let clips = parse_clippings(&decoded);
    assert_eq!(clips.len(), 6);
}

#[test]
fn strips_utf8_bom() {
    let decoded = decode_bytes("\u{FEFF}Title (Author)\n- Your Highlight on page 1 | Location 1-2 | Added on Monday, January 6, 2020 10:15:00 AM\n\nHi.\n==========\n".as_bytes());
    let clips = parse_clippings(&decoded);
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].title, "Title");
}

#[test]
fn content_hash_is_stable_and_unique() {
    let first_run = parse_clippings(&en_text());
    let second_run = parse_clippings(&en_text());
    assert_eq!(first_run, second_run);

    for clip in &first_run {
        assert_eq!(clip.content_hash.len(), 64);
        assert!(clip.content_hash.chars().all(|c| c.is_ascii_hexdigit()));
    }
    let mut hashes: Vec<_> = first_run.iter().map(|c| &c.content_hash).collect();
    hashes.sort();
    hashes.dedup();
    assert_eq!(hashes.len(), first_run.len());

    // Direct API determinism.
    let h1 = Clipping::hash_of(
        "T",
        Some("A"),
        ClippingKind::Highlight,
        Some(1),
        Some("1-2"),
        Some("x"),
    );
    let h2 = Clipping::hash_of(
        "T",
        Some("A"),
        ClippingKind::Highlight,
        Some(1),
        Some("1-2"),
        Some("x"),
    );
    assert_eq!(h1, h2);
}

#[test]
fn skips_malformed_entries() {
    assert!(parse_clippings("").is_empty());
    assert!(parse_clippings("just some text\n==========\n").is_empty());
    assert!(
        parse_clippings("Title (Author)\nno meta line here\n\nContent\n==========\n").is_empty()
    );
}
