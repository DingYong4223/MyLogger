# Filter Log Workflow

Use this workflow when the user asks to filter a log file and view only the matching log lines.

## Required Inputs

Require both:

- log file path
- filter keyword or regular expression

If the user does not provide a log path, ask for the log path and stop. If the user does not provide a keyword, ask for the keyword and stop. Do not guess either value.

## Tool Selection

Use `rg` to filter the source log into a temporary file, then open that filtered file with Neovim in a newly opened terminal window. This keeps the original log unchanged and avoids rendering Neovim inside embedded agent terminals.

## Commands

macOS Terminal:

```bash
filtered="$(mktemp -t mylogger-filtered-log.XXXXXX)"
rg -n -- "<keyword>" "<log-path>" > "$filtered" || true
syntax_file="$(mktemp -t mylogger-log-syntax.XXXXXX.vim)"
cat > "$syntax_file" <<'VIM'
syntax clear
syntax case match
syntax match MyLoggerSourceLine /^\d\+:/
syntax match MyLoggerTime /\v\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d{3}/
syntax match MyLoggerPidTid /\v\s+\d+\s+\d+\s+/
syntax match MyLoggerVerbose /\sV\s/
syntax match MyLoggerDebug /\sD\s/
syntax match MyLoggerInfo /\sI\s/
syntax match MyLoggerWarn /\sW\s/
syntax match MyLoggerError /\sE\s/
syntax match MyLoggerFatal /\sF\s/
syntax match MyLoggerTag /\v\s[VDIWEF]\s+\zs[^:]+ze\s*:/
highlight default MyLoggerSourceLine ctermfg=DarkGray guifg=#7F8490
highlight default MyLoggerTime ctermfg=Cyan guifg=#56B6C2
highlight default MyLoggerPidTid ctermfg=Yellow guifg=#E5C07B
highlight default MyLoggerVerbose ctermfg=Blue guifg=#61AFEF
highlight default MyLoggerDebug ctermfg=Blue guifg=#61AFEF
highlight default MyLoggerInfo ctermfg=Green guifg=#98C379
highlight default MyLoggerWarn ctermfg=Yellow guifg=#E5C07B
highlight default MyLoggerError ctermfg=Red guifg=#E06C75
highlight default MyLoggerFatal ctermfg=Red guifg=#FF5555
highlight default MyLoggerTag ctermfg=Magenta guifg=#C678DD
VIM
osascript -e 'tell application "Terminal" to activate' \
  -e "tell application \"Terminal\" to do script \"nvim +'set number' +'syntax on' +'source $syntax_file' '$filtered'\""
```

Generic terminal command if already outside Codex or another embedded terminal, after generating `syntax_file` with [neovim-log-highlighting.md](neovim-log-highlighting.md):

```bash
filtered="$(mktemp -t mylogger-filtered-log.XXXXXX)"
rg -n -- "<keyword>" "<log-path>" > "$filtered" || true
nvim +'set number' +'syntax on' +"source $syntax_file" "$filtered"
```

## Behavior Rules

- Validate that the provided log path exists before filtering.
- Preserve line numbers by using `rg -n`.
- Always enable Neovim line numbers with `+'set number'`.
- Always source the generated MyLogger syntax file. See [neovim-log-highlighting.md](neovim-log-highlighting.md).
- Use `--` before the keyword so patterns beginning with `-` are not parsed as flags.
- If no lines match, open a filtered file containing a short message such as `No matches for: <keyword>`.
- Open only the filtered result in Neovim; do not modify the original log.
- For literal keyword filtering, escape regex metacharacters or use `rg -F`.

## MyLogger Product Behavior

When implementing this in MyLogger, route natural-language intents like "过滤日志", "只看包含 error 的日志", or "筛选 123.txt 中的 crash" to a filter-log action:

1. If the path is missing, ask the user to provide the log file path.
2. If the keyword is missing, ask the user to provide the filter keyword.
3. Validate the path.
4. Generate a temporary filtered log file.
5. Generate the temporary MyLogger syntax file from [neovim-log-highlighting.md](neovim-log-highlighting.md).
6. Open a new terminal window and run `nvim +'set number' +'syntax on' +'source <syntax-file>' <filtered-file>`.
7. Keep the MyLogger TUI active while the external terminal shows the filtered log.
