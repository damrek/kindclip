import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app")!;

if ("__TAURI_INTERNALS__" in window) {
  mount(App, { target });
} else {
  // Plain `vite dev` / browser preview: the Tauri IPC bridge is missing.
  // Say so plainly instead of crashing on the first `invoke`.
  target.innerHTML =
    '<div style="display:flex;height:100%;align-items:center;justify-content:center;' +
    'font-family:system-ui,sans-serif;text-align:center;padding:2rem">' +
    "<p>kindclip necesita el runtime de Tauri.<br>Ejecuta <code>npx tauri dev</code> en vez de <code>npm run dev</code>.</p></div>";
}
