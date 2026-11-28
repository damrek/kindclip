use std::collections::HashMap;

use serde::Deserialize;
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize,
    Runtime, WebviewWindow,
};

#[derive(Clone, Debug, Deserialize)]
struct SavedWindow {
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    x: i32,
    #[serde(default)]
    y: i32,
    #[serde(default)]
    maximized: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct Placement {
    request: PhysicalSize<u32>,
    footprint: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    maximized: bool,
}

pub(crate) fn show_restored_window<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    default: LogicalSize<f64>,
) -> tauri::Result<()> {
    let saved = read_saved(app, window.label());
    let Some(monitor) = choose_monitor(window, saved.as_ref())? else {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let default = PhysicalSize::new(
        (default.width * scale).round() as u32,
        (default.height * scale).round() as u32,
    );
    let decoration = decoration_extent(window);
    let placement = placement(saved.as_ref(), *monitor.work_area(), default, decoration);

    window.set_size(placement.request)?;
    window.set_position(placement.position)?;
    if placement.maximized {
        window.maximize()?;
    }
    window.show()?;
    window.set_focus()?;

    log::info!(
        "window: requested {}x{} for {}x{}+{},{} (saved={}, maximized={}, decoration={}x{})",
        placement.request.width,
        placement.request.height,
        placement.footprint.width,
        placement.footprint.height,
        placement.position.x,
        placement.position.y,
        saved.is_some(),
        placement.maximized,
        decoration.width,
        decoration.height
    );
    Ok(())
}

fn placement(
    saved: Option<&SavedWindow>,
    work_area: PhysicalRect<i32, u32>,
    default: PhysicalSize<u32>,
    decoration: PhysicalSize<u32>,
) -> Placement {
    let maximized = saved.map(|state| state.maximized).unwrap_or(false);

    if let Some(saved) = saved {
        let footprint = PhysicalSize::new(saved.width, saved.height);
        if saved.width > 0
            && saved.height > 0
            && footprint.width <= work_area.size.width
            && footprint.height <= work_area.size.height
        {
            return Placement {
                request: request_size(footprint, decoration),
                footprint,
                position: clamp_position(
                    PhysicalPosition::new(saved.x, saved.y),
                    footprint,
                    work_area,
                ),
                maximized,
            };
        }
    }

    let request = PhysicalSize::new(
        default
            .width
            .min(work_area.size.width.saturating_sub(decoration.width))
            .max(1),
        default
            .height
            .min(work_area.size.height.saturating_sub(decoration.height))
            .max(1),
    );
    let footprint = PhysicalSize::new(
        request
            .width
            .saturating_add(decoration.width)
            .min(work_area.size.width),
        request
            .height
            .saturating_add(decoration.height)
            .min(work_area.size.height),
    );
    Placement {
        request,
        footprint,
        position: centered(footprint, work_area),
        maximized,
    }
}

fn request_size(footprint: PhysicalSize<u32>, decoration: PhysicalSize<u32>) -> PhysicalSize<u32> {
    PhysicalSize::new(
        footprint.width.saturating_sub(decoration.width).max(1),
        footprint.height.saturating_sub(decoration.height).max(1),
    )
}

fn clamp_position(
    position: PhysicalPosition<i32>,
    footprint: PhysicalSize<u32>,
    work_area: PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    let max_x =
        work_area.position.x as i64 + (work_area.size.width as i64 - footprint.width as i64);
    let max_y =
        work_area.position.y as i64 + (work_area.size.height as i64 - footprint.height as i64);
    PhysicalPosition::new(
        (position.x as i64).clamp(work_area.position.x as i64, max_x) as i32,
        (position.y as i64).clamp(work_area.position.y as i64, max_y) as i32,
    )
}

fn centered(
    footprint: PhysicalSize<u32>,
    work_area: PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        work_area.position.x + ((work_area.size.width - footprint.width) / 2) as i32,
        work_area.position.y + ((work_area.size.height - footprint.height) / 2) as i32,
    )
}

fn choose_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    saved: Option<&SavedWindow>,
) -> tauri::Result<Option<Monitor>> {
    let monitors = window.available_monitors()?;

    if let Some(saved) = saved.filter(|state| state.width > 0 && state.height > 0) {
        let saved_area = PhysicalRect {
            position: PhysicalPosition::new(saved.x, saved.y),
            size: PhysicalSize::new(saved.width, saved.height),
        };
        if let Some(monitor) = monitors
            .iter()
            .find(|monitor| intersects(*monitor.work_area(), saved_area))
        {
            return Ok(Some(monitor.clone()));
        }
    }

    Ok(window
        .primary_monitor()?
        .or_else(|| monitors.into_iter().next()))
}

fn intersects(a: PhysicalRect<i32, u32>, b: PhysicalRect<i32, u32>) -> bool {
    let a_right = a.position.x as i64 + a.size.width as i64;
    let a_bottom = a.position.y as i64 + a.size.height as i64;
    let b_right = b.position.x as i64 + b.size.width as i64;
    let b_bottom = b.position.y as i64 + b.size.height as i64;
    (a.position.x as i64) < b_right
        && (b.position.x as i64) < a_right
        && (a.position.y as i64) < b_bottom
        && (b.position.y as i64) < a_bottom
}

fn read_saved<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<SavedWindow> {
    let path = app
        .path()
        .app_config_dir()
        .ok()?
        .join(tauri_plugin_window_state::DEFAULT_FILENAME);
    let file = std::fs::File::open(path).ok()?;
    let mut states: HashMap<String, SavedWindow> = serde_json::from_reader(file).ok()?;
    states.remove(label)
}

#[cfg(target_os = "linux")]
fn decoration_extent<R: Runtime>(window: &WebviewWindow<R>) -> PhysicalSize<u32> {
    use gtk::prelude::*;

    let Ok(gtk_window) = window.gtk_window() else {
        return PhysicalSize::new(0, 0);
    };
    gtk_window.realize();
    let (content_width, content_height) = gtk_window.size();
    let Some(surface) = gtk_window.window() else {
        return PhysicalSize::new(0, 0);
    };
    let (_, _, surface_width, surface_height) = surface.geometry();
    let scale = surface.scale_factor() as f64;
    PhysicalSize::new(
        ((surface_width - content_width).max(0) as f64 * scale).round() as u32,
        ((surface_height - content_height).max(0) as f64 * scale).round() as u32,
    )
}

#[cfg(not(target_os = "linux"))]
fn decoration_extent<R: Runtime>(_: &WebviewWindow<R>) -> PhysicalSize<u32> {
    PhysicalSize::new(0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_area(width: u32, height: u32, x: i32, y: i32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(width, height),
        }
    }

    fn saved(width: u32, height: u32, x: i32, y: i32, maximized: bool) -> SavedWindow {
        SavedWindow {
            width,
            height,
            x,
            y,
            maximized,
        }
    }

    fn decoration() -> PhysicalSize<u32> {
        PhysicalSize::new(52, 89)
    }

    #[test]
    fn subtracts_the_decoration_from_a_saved_size() {
        let placement = placement(
            Some(&saved(1200, 800, 200, 100, false)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1148, 711),
                footprint: PhysicalSize::new(1200, 800),
                position: PhysicalPosition::new(200, 100),
                maximized: false,
            }
        );
    }

    #[test]
    fn clamps_a_saved_position_to_the_work_area() {
        let placement = placement(
            Some(&saved(1200, 800, 1800, 900, false)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1148, 711),
                footprint: PhysicalSize::new(1200, 800),
                position: PhysicalPosition::new(720, 280),
                maximized: false,
            }
        );
    }

    #[test]
    fn resets_a_saved_size_taller_than_the_work_area() {
        let placement = placement(
            Some(&saved(1769, 1157, 0, 0, false)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1120, 760),
                footprint: PhysicalSize::new(1172, 849),
                position: PhysicalPosition::new(374, 131),
                maximized: false,
            }
        );
    }

    #[test]
    fn keeps_maximized_when_the_saved_size_is_reset() {
        let placement = placement(
            Some(&saved(1769, 1157, 0, 0, true)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1120, 760),
                footprint: PhysicalSize::new(1172, 849),
                position: PhysicalPosition::new(374, 131),
                maximized: true,
            }
        );
    }

    #[test]
    fn clamps_the_fallback_to_a_small_work_area() {
        let placement = placement(
            Some(&saved(3000, 2000, 0, 0, false)),
            work_area(800, 600, 0, 0),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(748, 511),
                footprint: PhysicalSize::new(800, 600),
                position: PhysicalPosition::new(0, 0),
                maximized: false,
            }
        );
    }

    #[test]
    fn centers_on_a_monitor_with_a_negative_origin() {
        let placement = placement(
            Some(&saved(3000, 2000, 0, 0, false)),
            work_area(1920, 1048, -1920, 0),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1120, 760),
                footprint: PhysicalSize::new(1172, 849),
                position: PhysicalPosition::new(-1546, 99),
                maximized: false,
            }
        );
    }

    #[test]
    fn uses_the_default_when_nothing_was_saved() {
        let placement = placement(
            None,
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1120, 760),
                footprint: PhysicalSize::new(1172, 849),
                position: PhysicalPosition::new(374, 131),
                maximized: false,
            }
        );
    }

    #[test]
    fn ignores_a_zero_saved_size() {
        let placement = placement(
            Some(&saved(0, 0, 10, 10, false)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            decoration(),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1120, 760),
                footprint: PhysicalSize::new(1172, 849),
                position: PhysicalPosition::new(374, 131),
                maximized: false,
            }
        );
    }

    #[test]
    fn round_trips_a_saved_size_without_decorations() {
        let placement = placement(
            Some(&saved(1200, 800, 200, 100, false)),
            work_area(1920, 1048, 0, 32),
            PhysicalSize::new(1120, 760),
            PhysicalSize::new(0, 0),
        );
        assert_eq!(
            placement,
            Placement {
                request: PhysicalSize::new(1200, 800),
                footprint: PhysicalSize::new(1200, 800),
                position: PhysicalPosition::new(200, 100),
                maximized: false,
            }
        );
    }
}
