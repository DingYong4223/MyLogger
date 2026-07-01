# Neovim 学习指南

## 目录
1. [核心概念：模式编辑](#1-核心概念模式编辑)
2. [安装与基础配置](#2-安装与基础配置)
3. [模式详解](#3-模式详解)
4. [移动光标](#4-移动光标)
5. [编辑操作](#5-编辑操作)
6. [搜索与替换](#6-搜索与替换)
7. [文件与缓冲区](#7-文件与缓冲区)
8. [分屏与窗口](#8-分屏与窗口)
9. [配置文件](#9-配置文件)
10. [插件生态](#10-插件生态)
11. [大文件专项配置](#11-大文件专项配置)
12. [常用速查表](#12-常用速查表)

---

## 1. 核心概念：模式编辑

**这是与 UltraEdit 最大的区别，必须先理解。**

Neovim 有多种「模式」，键盘按键的含义完全取决于当前所在的模式：

```
┌─────────────────────────────────────────────────┐
│                Normal Mode (默认)                 │
│         按键 = 命令，不是输入文字                  │
└───────────┬─────────────┬────────────────────────┘
            │ i/a/o       │ v/V/Ctrl-v
            ▼             ▼
     Insert Mode      Visual Mode
    （输入文字）       （选择文本）
            │
           Esc
            │
            ▼
    回到 Normal Mode
```

**关键心法：**
- 打开文件 → Normal Mode（不能直接打字）
- 按 `i` 进入 Insert Mode → 现在可以打字
- 按 `Esc` 退出任何模式 → 回到 Normal Mode
- **大量操作在 Normal Mode 完成**，这正是它快的原因

---

## 2. 安装与基础配置

### 安装

```bash
# macOS
brew install neovim

# Ubuntu/Debian
sudo apt install neovim

# Windows (scoop)
scoop install neovim

# 验证安装
nvim --version
```

### 第一次启动

```bash
nvim          # 打开空白页面
nvim file.txt # 打开文件
```

进入后先执行 `:Tutor` —— Neovim 内置的交互式教程，约 30 分钟，强烈建议先完成。

---

## 3. 模式详解

| 模式 | 进入方式 | 状态栏显示 | 用途 |
|------|---------|-----------|------|
| Normal | `Esc` | （空） | 移动、命令 |
| Insert | `i` `a` `o` | `-- INSERT --` | 输入文字 |
| Visual | `v` | `-- VISUAL --` | 选择字符 |
| Visual Line | `V` | `-- VISUAL LINE --` | 选择整行 |
| Visual Block | `Ctrl-v` | `-- VISUAL BLOCK --` | 列选择（类似 UltraEdit 列模式）|
| Command | `:` | 底部出现 `:` | 执行命令 |
| Replace | `R` | `-- REPLACE --` | 覆盖输入 |

---

## 4. 移动光标

### 基础移动（Normal Mode）

```
h  ←   j  ↓   k  ↑   l  →

比方向键快，因为手不离主键盘区
```

### 单词级移动

```
w   跳到下一个单词开头
b   跳到上一个单词开头
e   跳到当前单词结尾
W B E  同上，但以空格为分隔符（更大粒度）
```

### 行内移动

```
0         行首
^         行首（第一个非空字符）
$         行尾
f{char}   跳到当前行下一个 {char}    例：fa 跳到下一个 'a'
t{char}   跳到 {char} 前一个字符
F{char}   反向查找
;         重复上次 f/t 查找
,         反向重复
```

### 页面级移动

```
gg      文件开头
G       文件结尾
{n}G    跳到第 n 行       例：100G 跳到第 100 行
Ctrl-d  向下翻半页
Ctrl-u  向上翻半页
Ctrl-f  向下翻整页
Ctrl-b  向上翻整页
H       屏幕顶部
M       屏幕中间
L       屏幕底部
zz      当前行居中显示
```

---

## 5. 编辑操作

### 进入 Insert Mode 的几种方式

```
i   光标前插入
a   光标后插入（append）
I   行首插入
A   行尾插入
o   下方新建一行并进入 Insert
O   上方新建一行并进入 Insert
s   删除当前字符并进入 Insert
S   删除整行并进入 Insert（= cc）
```

### 删除（Normal Mode）

```
x       删除当前字符
dd      删除整行
d$  或  D   删除到行尾
d0          删除到行首
dw          删除一个单词
d{n}w       删除 n 个单词
{n}dd       删除 n 行      例：5dd 删除5行
```

### 复制与粘贴

```
yy      复制整行（yank）
yw      复制一个单词
y$      复制到行尾
{n}yy   复制 n 行
p       在光标后粘贴
P       在光标前粘贴
```

> Neovim 的复制粘贴使用「寄存器」概念，`"` 开头可指定寄存器，`"+y` 复制到系统剪贴板。

### 修改（Change = 删除 + 进入 Insert）

```
cw      修改一个单词
cc  或  S   修改整行
c$  或  C   修改到行尾
ci"     修改引号内的内容（change inside "）
ca(     修改括号及内容（change around ()）
```

### 撤销与重做

```
u       撤销（undo）
Ctrl-r  重做（redo）
.       重复上一个操作（极其强大！）
```

### Text Objects（文本对象，UltraEdit 没有的杀手级特性）

```
格式：{动作}{范围}{对象}

动作：d(删除) c(修改) y(复制) v(选择)
范围：i(inside 内部) a(around 包含)
对象：w(单词) s(句子) p(段落) "(双引号) '(单引号) `(反引号) ((括号) {(花括号) [(方括号) t(HTML标签)

示例：
diw   删除当前单词（不含空格）
daw   删除当前单词（含空格）
ci"   修改双引号内的内容
da(   删除括号及其内容
yip   复制当前段落
```

---

## 6. 搜索与替换

### 搜索

```
/pattern    向下搜索 pattern
?pattern    向上搜索 pattern
n           下一个匹配
N           上一个匹配
*           搜索光标下的单词（向下）
#           搜索光标下的单词（向上）
:noh        清除高亮
```

### 替换（Command Mode）

```
:s/old/new/         替换当前行第一个
:s/old/new/g        替换当前行所有
:%s/old/new/g       替换全文所有
:%s/old/new/gc      替换全文，逐个确认（c = confirm）
:10,20s/old/new/g   替换第 10-20 行
```

### 替换标志位

```
g   全部匹配（不加只替换第一个）
c   逐个确认
i   忽略大小写
I   区分大小写
```

---

## 7. 文件与缓冲区

### 文件操作（Command Mode，以 `:` 开头）

```
:w          保存
:w filename 另存为
:q          退出
:q!         强制退出（不保存）
:wq  或 :x  保存并退出
:e filename 打开文件
:e!         重新加载文件（放弃修改）
```

### 缓冲区（Buffer）

Neovim 中每个打开的文件是一个「缓冲区」：

```
:ls  或 :buffers   列出所有缓冲区
:b {n}             切换到第 n 个缓冲区
:bn                下一个缓冲区
:bp                上一个缓冲区
:bd                关闭当前缓冲区
```

---

## 8. 分屏与窗口

```
:sp   或 Ctrl-w s   水平分屏
:vsp  或 Ctrl-w v   垂直分屏
Ctrl-w h/j/k/l      在窗口间移动
Ctrl-w =            等分所有窗口
Ctrl-w q            关闭当前窗口
:tabnew             新建标签页
gt / gT             切换标签页
```

---

## 9. 配置文件

Neovim 配置文件位置：

```bash
~/.config/nvim/init.lua   # 推荐（Lua，现代方式）
~/.config/nvim/init.vim   # 传统 VimScript
```

### 最小化推荐配置（init.lua）

```lua
-- 行号
vim.opt.number = true          -- 显示行号
vim.opt.relativenumber = true  -- 相对行号（快速跳转神器）

-- 缩进
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true       -- Tab 转空格
vim.opt.autoindent = true

-- 搜索
vim.opt.ignorecase = true      -- 搜索忽略大小写
vim.opt.smartcase = true       -- 有大写字母时区分
vim.opt.hlsearch = true        -- 高亮搜索结果
vim.opt.incsearch = true       -- 实时搜索

-- 显示
vim.opt.wrap = false           -- 不自动换行
vim.opt.cursorline = true      -- 高亮当前行
vim.opt.termguicolors = true   -- 真彩色
vim.opt.scrolloff = 8          -- 光标距屏幕边缘保持 8 行

-- 系统剪贴板
vim.opt.clipboard = "unnamedplus"

-- 性能
vim.opt.updatetime = 250       -- 更快的响应速度

-- 快捷键 Leader 键设为空格（非常常见的选择）
vim.g.mapleader = " "

-- 常用快捷键映射
local map = vim.keymap.set
map("n", "<leader>w", ":w<CR>")        -- 空格+w 保存
map("n", "<leader>q", ":q<CR>")        -- 空格+q 退出
map("n", "<Esc>", ":noh<CR>")          -- Esc 清除搜索高亮
map("n", "H", "^")                     -- H 跳行首
map("n", "L", "$")                     -- L 跳行尾
```

---

## 10. 插件生态

### 包管理器：lazy.nvim（当前标准）

```lua
-- 在 init.lua 中添加

-- 安装 lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({ "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git", lazypath })
end
vim.opt.rtp:prepend(lazypath)

-- 配置插件
require("lazy").setup({
  -- 文件树
  { "nvim-tree/nvim-tree.lua" },
  -- 模糊查找（类似 UltraEdit 的文件/内容搜索）
  { "nvim-telescope/telescope.nvim", dependencies = { "nvim-lua/plenary.nvim" } },
  -- 语法高亮
  { "nvim-treesitter/nvim-treesitter", build = ":TSUpdate" },
  -- 主题
  { "folke/tokyonight.nvim" },
  -- 状态栏
  { "nvim-lualine/lualine.nvim" },
  -- LSP（代码补全、跳转定义）
  { "neovim/nvim-lspconfig" },
})
```

### 推荐插件清单

| 插件 | 功能 | 类比 UltraEdit |
|------|------|----------------|
| **telescope.nvim** | 模糊搜索文件/内容 | Ctrl+F 文件搜索 |
| **nvim-tree.lua** | 文件树侧边栏 | 文件资源管理器 |
| **treesitter** | 语法高亮（精准） | 语法着色 |
| **nvim-lspconfig** | 代码补全/跳转 | 内置 IDE 功能 |
| **gitsigns.nvim** | Git 行内标注 | - |
| **which-key.nvim** | 快捷键提示 | 帮助菜单 |
| **Comment.nvim** | 快速注释 | 块注释 |
| **nvim-surround** | 修改括号/引号 | - |

### 一键起步：使用发行版

如果不想手动配置，直接用现成的发行版：

```bash
# LazyVim（推荐，现代且完整）
git clone https://github.com/LazyVim/starter ~/.config/nvim

# AstroNvim（功能全面）
git clone --depth 1 https://github.com/AstroNvim/template ~/.config/nvim
```

---

## 11. 大文件专项配置

```lua
-- 大文件自动禁用重量级特性（超过 10MB）
vim.api.nvim_create_autocmd("BufReadPre", {
  callback = function(args)
    local file_size = vim.fn.getfsize(args.file)
    if file_size > 10 * 1024 * 1024 then  -- 10MB
      vim.opt_local.swapfile = false
      vim.opt_local.backup = false
      vim.opt_local.undofile = false
      vim.opt_local.syntax = "off"       -- 关闭语法高亮（速度关键）
      vim.b.large_file = true
      print("Large file mode enabled")
    end
  end,
})

-- 禁用 treesitter（大文件时）
vim.api.nvim_create_autocmd("BufReadPre", {
  callback = function()
    if vim.b.large_file then
      vim.cmd("TSBufDisable highlight")
    end
  end,
})
```

### 大文件推荐命令

```vim
:set noswapfile     " 不创建交换文件
:set nobackup       " 不创建备份
:set syntax=off     " 关闭语法高亮（显著提速）
:set lazyredraw     " 延迟重绘
```

---

## 12. 常用速查表

### 必记的 20 个操作

```
进入/退出
  i       进入插入模式
  Esc     返回 Normal 模式
  :wq     保存退出
  :q!     强制退出

移动
  hjkl    ←↓↑→
  w/b     单词前进/后退
  gg/G    文件开头/结尾
  {n}G    跳到第n行

编辑
  dd      删除行
  yy      复制行
  p       粘贴
  u       撤销
  .       重复上一操作（最强！）
  ciw     修改当前单词
  ci"     修改引号内内容

搜索
  /text         搜索
  n/N           下一个/上一个
  :%s/a/b/g     全文替换
```

### 学习路径建议

```
第1周：掌握 hjkl 移动 + i/Esc 切换 + :wq 保存退出
第2周：掌握 w/b/0/$ + dd/yy/p + u + /搜索
第3周：掌握 Text Objects (ciw, ci") + . 重复
第4周：配置 init.lua + 安装基础插件
第1月后：开始用 telescope、LSP 等高级功能
```

---

## 快速上手路径

```bash
# 1. 安装
brew install neovim   # macOS

# 2. 先做内置教程（30分钟）
nvim
:Tutor

# 3. 用最小配置开始
mkdir -p ~/.config/nvim
nvim ~/.config/nvim/init.lua
# 粘贴上面「最小化推荐配置」

# 4. 安装 LazyVim 发行版（可选，适合想快速可用的人）
git clone https://github.com/LazyVim/starter ~/.config/nvim
nvim
```

> 💡 **最重要的建议**：前两周强迫自己用 Neovim 做日常工作，哪怕很痛苦。过了肌肉记忆的坎，你会发现再也不想回去了。
