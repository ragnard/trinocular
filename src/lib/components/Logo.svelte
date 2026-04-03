<span class="logo">🐷</span>

<style>
 .logo {
     background: var(--bg-0);
     border-radius: 50%;
     border: 1px solid var(--border);
     display: inline-flex;
     align-items: center;
     justify-content: center;
     width: 2em;
     height: 2em;
     font-size: 1.0em;
     animation: spin 37s linear infinite;
  }

  @keyframes spin {
     /* spin at ~5s */
     13% { transform: rotate(0deg); }
     14% { transform: rotate(360deg); }
     /* spin at ~12s */
     32% { transform: rotate(360deg); }
     33% { transform: rotate(720deg); }
     /* spin at ~20s */
     53% { transform: rotate(720deg); }
     54% { transform: rotate(1080deg); }
     /* spin at ~28s */
     75% { transform: rotate(1080deg); }
     76% { transform: rotate(1440deg); }
     /* spin at ~34s */
     91% { transform: rotate(1440deg); }
     92% { transform: rotate(1800deg); }
     100% { transform: rotate(1800deg); }
  }
</style>
