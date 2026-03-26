<div class="spinner"></div>

<style>
  .spinner {
    width: 2em;
    height: 2em;
    border: 4px solid var(--border, #e0e0e0);
    border-top-color: var(--accent, #c0c0c0);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
