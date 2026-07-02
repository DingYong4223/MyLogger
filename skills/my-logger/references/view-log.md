# View Log Workflow

Use this workflow when the user asks to view, open, inspect, or browse a log file rather than analyze it directly.

## Tool Selection

Use Neovim in a newly opened terminal window. If the user does not provide a log path, ask the user to specify one before executing any viewer command. Do not launch a file picker for this workflow.

## Commands

When the user provides a log path:

macOS Terminal:

```bash
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
  -e "tell application \"Terminal\" to do script \"cd '<working-directory>' && nvim +'set number' +'syntax on' +'source $syntax_file' '<log-path>'\""
```

Generic terminal command if already outside Codex or another embedded terminal, after generating `syntax_file` with [neovim-log-highlighting.md](neovim-log-highlighting.md):

```bash
nvim +'set number' +'syntax on' +"source $syntax_file" <log-path>
```

## Behavior Rules

- If the user did not provide a path, ask for the log path and stop.
- Validate that the provided path exists before opening it.
- Prefer opening a new terminal window because embedded agent terminals may not render Neovim correctly.
- Always enable Neovim line numbers with `+'set number'`.
- Always source the generated MyLogger syntax file. See [neovim-log-highlighting.md](neovim-log-highlighting.md).
- Open the file for viewing; do not modify log contents.
- For very large logs, recommend search/navigation inside Neovim instead of copying large sections into chat.

## MyLogger Product Behavior

When implementing this in MyLogger, route a natural-language intent like "查看日志" or "打开日志" to a view-log action:

1. If the intent does not include a path, ask the user to provide a log file path.
2. If the intent includes a path, validate that the path exists.
3. Generate the temporary MyLogger syntax file from [neovim-log-highlighting.md](neovim-log-highlighting.md).
4. Open a new terminal window and run `nvim +'set number' +'syntax on' +'source <syntax-file>' <log-path>` from the appropriate working directory.
5. Keep the MyLogger TUI active; the log viewer runs in the separate terminal.
