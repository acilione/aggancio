<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  let { title, onDismiss, children, wide = false }: { title: string; onDismiss: () => void; children: Snippet; wide?: boolean } = $props();
  let dialog: HTMLDialogElement;
  const titleId = `dialog-${crypto.randomUUID()}`;
  onMount(() => { dialog.showModal(); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} class:wide aria-labelledby={titleId} onclose={onDismiss} onclick={(event) => { if (event.target === dialog) onDismiss(); }} onkeydown={(event) => { if (event.key === 'Escape') onDismiss(); }}>
  <div class="dialog-shell">
    <header class="dialog-header"><h2 id={titleId}>{title}</h2><button class="icon-button" onclick={onDismiss} aria-label="Close dialog"><X size={22} /></button></header>
    <div class="dialog-body">{@render children()}</div>
  </div>
</dialog>
