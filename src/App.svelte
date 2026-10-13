<script lang="ts">
  // Scaffold shell (T1). Import flow lands in T4, list/filters in T5.
  const productName = "kindclip";
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
        disabled
        title="Disponible en T4"
        class="mt-4 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white opacity-40 dark:bg-white dark:text-neutral-900"
      >
        Importar clippings
      </button>
    </div>
  </main>
</div>
