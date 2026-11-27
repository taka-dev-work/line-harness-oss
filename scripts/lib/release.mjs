// The deploy must run exactly the release a client.json pins: its tag has to resolve
// to release.commit, and the checked-out HEAD has to be that commit.

/**
 * @param {{ release: {tag: string, commit: string}, tagCommit: string|null, headCommit: string }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkRelease({ release, tagCommit, headCommit }) {
  const errors = [];
  if (!tagCommit) errors.push(`tag ${release.tag} not found`);
  else if (tagCommit !== release.commit) errors.push(`tag ${release.tag} points to ${tagCommit}, client.json pins ${release.commit}`);
  if (headCommit !== release.commit) errors.push(`checked-out HEAD ${headCommit} is not release.commit ${release.commit}`);
  return { ok: errors.length === 0, errors };
}
