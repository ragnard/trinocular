/** Stamped in by vite's `define`; vite.config.ts is where the values come from. */
declare const __TRINOCULAR_BUILD__: Build;

export interface Build {
  version: string;
  /** The full hash, when the build was told it; absent for one that was not. */
  commit?: string;
  /** Where the code lives, from package.json. */
  source: string;
}

export const BUILD: Build = __TRINOCULAR_BUILD__;

/** The hash as `git log --oneline` prints it. */
export const shortCommit = (build: Build): string | undefined => build.commit?.slice(0, 7);

/** The commit on the forge, for a link. */
export const commitUrl = (build: Build): string | undefined =>
  build.commit && `${build.source}/commit/${build.commit}`;

/** `trinocular 0.1.36 · 871beae`: one line for a tooltip or a log. */
export const describeBuild = (build: Build): string => {
  const commit = shortCommit(build);
  return commit ? `trinocular ${build.version} · ${commit}` : `trinocular ${build.version}`;
};
