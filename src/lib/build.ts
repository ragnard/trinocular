/** Stamped in by vite's `define`; vite.config.ts is where the values come from. */
declare const __TRINETTE_BUILD__: Build;

export interface Build {
  version: string;
  /** The full hash, when the build was told it; absent for one that was not. */
  commit?: string;
  /** Where the code lives, from package.json. */
  source: string;
}

export const BUILD: Build = __TRINETTE_BUILD__;

/** The hash as `git log --oneline` prints it. */
export const shortCommit = (build: Build): string | undefined => build.commit?.slice(0, 7);

/** The commit on the forge, for a link. */
export const commitUrl = (build: Build): string | undefined =>
  build.commit && `${build.source}/commit/${build.commit}`;

/** `trinette 0.1.36 · 871beae`: one line for a tooltip or a log. */
export const describeBuild = (build: Build): string => {
  const commit = shortCommit(build);
  return commit ? `trinette ${build.version} · ${commit}` : `trinette ${build.version}`;
};
