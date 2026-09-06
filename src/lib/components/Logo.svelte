<span class="logo">🐷</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: none;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    background: var(--s0);
    font-size: var(--text-sm);
    line-height: 1;
    animation: pig 37s linear infinite;
  }

  /* Idles, then bolts, a few times a minute. */
  @keyframes pig {
    13% { transform: rotate(0deg); }
    14% { transform: rotate(360deg); }
    32% { transform: rotate(360deg); }
    33% { transform: rotate(720deg); }
    53% { transform: rotate(720deg); }
    54% { transform: rotate(1080deg); }
    75% { transform: rotate(1080deg); }
    76% { transform: rotate(1440deg); }
    91% { transform: rotate(1440deg); }
    92% { transform: rotate(1800deg); }
    100% { transform: rotate(1800deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .logo {
      animation: none;
    }
  }
</style>
