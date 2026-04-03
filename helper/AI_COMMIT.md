# AI Commit Helper

## Task
Read the output of the following command:
```bash
git diff --staged
```

Read the files and from the out put
Generate a git commit command:
## Commit Message Format (Conventional Commits)
```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

**Types:** `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore` | `perf` | `ci` | `build`

**Rules:**
- Summary: imperative mood, lowercase, no period, max 72 chars
- Scope: optional, describes the area (e.g. `auth`, `api`, `ui`)
- Body: explain *what* and *why*, not *how* (wrap at 72 chars)
- Footer: use `BREAKING CHANGE:` or `Closes #123` when relevant

## Output
Reply with only the ready-to-run git command, like:
```bash
git commit -m "feat(auth): add refresh token rotation"
```

Or for multi-line:
```bash
git commit -m "feat(auth): add refresh token rotation" \
           -m "Implements sliding session logic. Tokens auto-renew on each request."
```
