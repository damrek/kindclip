<script lang="ts">
  import { runImportFlow, tauriImportDeps } from "./lib/importer";

  const productName = "kindclip";
  let status: string | null = null;
  let busy = false;

  async function onImport(): Promise<void> {
    if (busy) return;
    busy = true;
    status = "Leyendo fichero…";
    try {
      const outcome = await runImportFlow(tauriImportDeps(), (done, total) => {
        status = `Importando ${done}/${total}…`;
      });
      if (outcome.status === "cancelled") {
        status = null;
      } else if (outcome.status === "empty") {
        status = `Sin clippings en ${outcome.path}.`;
      } else {
        const report = outcome.report;
        status = report.alreadyImported
          ? "Ese fichero ya estaba importado."
          : `Importados ${report.inserted} de ${report.total} (${report.duplicates} duplicados, ${report.bookCount} libros).`;
      }
    } catch (error) {
      status = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex h-full flex-col">
  <header class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h1 class="text-lg font-semibold tracking-tight">{productName}</h1>
    <p class="text-sm text-neutral-500 dark:text-neutral-400">
      Tus subrayados de Kindle, en un solo lugar.
    </p>
  </header>

  <main class="flex flex-1 items-center justify-center px-6">
    <div class="max-w-sm text-center">
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl dark:bg-amber-950"
        aria-hidden="true"
      >
        &#10077;
      </div>
      <h2 class="text-base font-medium">Todavía no hay clippings</h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Importa tu fichero <span class="font-mono">My Clippings.txt</span> para
        empezar.
      </p>
      <button
        type="button"
        onclick={onImport}
        disabled={busy}
        class="mt-4 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? "Importando…" : "Importar clippings"}
      </button>
      {#if status}
        <p class="mt-3 text-sm text-neutral-500 dark:text-neutral-400" role="status">{status}</p>
      {/if}
    </div>
  </main>
</div>
