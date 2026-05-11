# TinyBit desktop wrapper — header-migration + Issue 2 fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the C/SDL desktop wrapper (`MeesCode/TinyBit`) in line with the new engine struct layout (header inside `TinyBitMemory`, `TB_MEM_SCRIPT_SIZE` redefined to 32 622, `TB_MEM_CARTRIDGE_SCRIPT_SIZE` removed), and simultaneously fix Issue 2 from `feeback.md`: the C encoder's 4-byte heap-buffer overrun when a script hits the documented max.

**Architecture:** Two small edits in one repo. Bump the `src/tinybit` submodule pointer to the engine SHA `d789a2bf7023504b94bec8ee2ff3b1cdb236e8fe` (already on `origin/main` of `MeesCode/TinyBit-lib`). Update `src/cartridge_io.c` to replace the removed constant and to cap the script at `TB_MEM_SCRIPT_SIZE - 1` so the steganographic write of `script_size + 1` bytes (script + trailing NUL) stays within the cartridge's 32 622-byte script payload window. Wire format is unchanged.

**Tech Stack:** C, SDL2/SDL2_image, GNU make. Windows builds via the existing `TinyBit.vcxproj` (untouched by this change). Reference engine code is vendored at `src/tinybit/`.

**Spec for the engine change this is reacting to:** `/home/mees/git/tinybit-wasm/docs/superpowers/specs/2026-05-11-tinybit-header-in-memory-design.md`

**Repo paths used below:**
- Desktop wrapper: `/mnt/c/Users/mbrin/git/TinyBit` (WSL path; same tree as Windows `C:\Users\mbrin\git\TinyBit`). Default branch is `master`, **not** `main`.
- Engine submodule inside it: `/mnt/c/Users/mbrin/git/TinyBit/src/tinybit` (`MeesCode/TinyBit-lib`).

---

## Scope of this plan

**Touches:**
- `src/tinybit` (submodule pointer)
- `src/cartridge_io.c` (one constant rename + one off-by-one cap)

**Does NOT touch:**
- The engine submodule itself (already updated, pushed at `d789a2b`).
- `src/main.c` (uses `struct TinyBitMemory tb_mem = {0};` — the `{0}` initializer covers the new `header` field; no edits required).
- `src/platform.h` (declares `extern struct TinyBitMemory tb_mem;` — type only; no edits required).
- `src/games.c`, `src/games.h`, `src/platform.c` (no references to the affected constants).
- `Makefile`, `CMakeLists.txt`, `TinyBit.vcxproj`, `TinyBit.sln` (build system unaffected; struct size change is silent).
- Any tests (no test suite in this repo).

---

## File map

**Engine submodule pointer (`src/tinybit`):** advance from `50dbc87` to `d789a2bf7023504b94bec8ee2ff3b1cdb236e8fe`.

**Modify: `src/cartridge_io.c` (two lines, around line 200 and the error string on line 203)**

Current state (verified):

```c
198    int script_size = strlen(source);
199    int cartridge_size = TB_MEM_CARTRIDGE_SCRIPT_SIZE;
200
201    if (script_size > cartridge_size) {
202        printf("cartridge too small to fit game (script %d > max %d)\n", script_size, cartridge_size);
203        free(source);
204        exit(EXIT_FAILURE);
205    }
```

Problem after the engine change:
- `TB_MEM_CARTRIDGE_SCRIPT_SIZE` no longer exists → compile error.
- Even if renamed to `TB_MEM_SCRIPT_SIZE` (32 622), the existing logic admits `script_size == 32 622`, and then `encode_bytes(..., script_size + 1, ...)` on line 243 writes **32 623** script payload bytes into the 32 622-byte cartridge slot — that's exactly Issue 2 (4 bytes of pixel-buffer overrun at the encoder's malloc'd buffer tail).

Fix (one line, plus a comment):

```c
int cartridge_size = TB_MEM_SCRIPT_SIZE - 1; // reserve 1 byte for the trailing NUL written below
```

After the change, `script_size <= 32 621`, so the `encode_bytes(..., script_size + 1, ...)` call writes at most 32 622 bytes — exactly the cartridge's script payload size. The error-message format string already references `cartridge_size`, so the printed max becomes `32621` automatically — no further edit needed. (The percentage-used line below also references `cartridge_size`; it now reports against the safe max, which is the truthful number.)

---

## Task 1: Bump the engine submodule pointer

**Working directory:** `/mnt/c/Users/mbrin/git/TinyBit`

- [ ] **Step 1: Make sure the desktop repo is on `master` and clean**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
git status -sb
```
Expected: `## master...origin/master` with no other lines (clean tree). If anything is dirty, stop and ask before continuing.

- [ ] **Step 2: Switch the engine submodule to `main` and pull the new SHA**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit/src/tinybit
git status            # likely "HEAD detached at 50dbc87"
git checkout main
git pull --ff-only origin main
git log -1 --oneline  # should show d789a2b "store cartridge header in TinyBitMemory"
```
Expected: submodule fast-forwards to `d789a2bf7023504b94bec8ee2ff3b1cdb236e8fe`. If it goes further (a newer engine commit landed in the meantime), stop and check — the rest of this plan assumes that SHA.

- [ ] **Step 3: Confirm the parent index sees the bump as a pending change**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
git status
```
Expected: `modified:   src/tinybit (new commits)`. Don't commit yet — bundle with Task 2's edit so the build never breaks between commits.

---

## Task 2: Rename the constant and fix the off-by-one

**Files:**
- Modify: `/mnt/c/Users/mbrin/git/TinyBit/src/cartridge_io.c` (line 200 only)

- [ ] **Step 1: Apply the edit**

Replace this line (exactly as it appears today):

```c
    int cartridge_size = TB_MEM_CARTRIDGE_SCRIPT_SIZE;
```

with:

```c
    int cartridge_size = TB_MEM_SCRIPT_SIZE - 1; // reserve 1 byte for the trailing NUL written below
```

Everything else in `export_cartridge` stays as-is. Do not touch `pack_header`, do not touch the spritesheet/cover/buffer logic.

- [ ] **Step 2: Verify no other consumers of `TB_MEM_CARTRIDGE_SCRIPT_SIZE` remain**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
grep -rn "TB_MEM_CARTRIDGE_SCRIPT_SIZE" src/ include/ 2>/dev/null
```
Expected: zero output. (Pre-flight grep already confirmed only the one site exists in the wrapper.)

---

## Task 3: Build and verify

**Working directory:** `/mnt/c/Users/mbrin/git/TinyBit`

The desktop wrapper builds on Linux/WSL via `make`. The Windows project file (`.vcxproj`) compiles the same sources and is unaffected.

- [ ] **Step 1: Clean build**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
make clean 2>&1 | tail -5
make 2>&1 | tail -20
```
Expected: build succeeds with the new `bin/tinybit` binary. Pay attention to any warning about `cartridge_io.c`. A pre-existing warning load is acceptable, but a NEW warning on the changed line (line 200) is a red flag.

If SDL2 / SDL2_image headers aren't installed in WSL, install them first:
```bash
sudo apt-get install -y libsdl2-dev libsdl2-image-dev libsdl2-mixer-dev
```

- [ ] **Step 2: Run a quick encode sanity check**

The wrapper's `-c` mode encodes a cartridge from sprite + script + cover. Use one of the bundled examples:

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
ls assets/                                          # find a sprite + cover
ls games/                                           # find an example source
./bin/tinybit -c <sprite.png> <script.lua> <cover.png> /tmp/test.tb.png 2>&1 | tail -5
ls -l /tmp/test.tb.png
file /tmp/test.tb.png                                # should be PNG image 256x256
```
Expected: command exits 0, prints "Game exported", writes a 256×256 PNG. The "percentage used" line should show a max of 32621 (the new safe cap).

If `bin/tinybit -c` needs different arguments than shown above, check `./bin/tinybit -h` and adjust — the call signature isn't being changed by this plan.

- [ ] **Step 3: Round-trip the encoded cartridge through the WASM engine**

The WASM engine is now header-in-memory aware. Round-tripping the freshly-encoded cartridge through it is the strongest available correctness check (the cartridge format is byte-identical between the two encoders, so the WASM decoder should parse it the same way it parses Rust-encoded cartridges).

```bash
cd /home/mees/git/tinybit-wasm
node -e '
  import("fs").then(async fs => {
    const buf = fs.readFileSync("/tmp/test.tb.png");
    process.stdout.write("cartridge size: " + buf.length + " bytes\n");
    process.stdout.write("first 4 bytes: " + [...buf.slice(0,4)].map(b => b.toString(16)).join(" ") + "\n");
  });
'
```
Expected: 256×256 PNG (~25-50 KB typical), first 4 bytes `89 50 4e 47` (PNG magic). A full WASM round-trip requires either an extension of `scripts/smoke_encoder.mjs` or a manual play in the browser — for this plan, the byte-level sanity check is enough; live play is a follow-up if a regression is suspected.

- [ ] **Step 4: Confirm script-size cap behavior with a regression check**

Make a script that exactly hits the new safe max (32 621 bytes) and confirm it is accepted, then one that exceeds it (32 622 bytes) and confirm it is rejected with the new error.

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
mkdir -p /tmp/tb-regress
python3 -c "open('/tmp/tb-regress/script_ok.lua', 'wb').write(b'-- ' + b'x' * (32621 - 3))"
python3 -c "open('/tmp/tb-regress/script_bad.lua', 'wb').write(b'-- ' + b'x' * (32622 - 3))"
wc -c /tmp/tb-regress/script_ok.lua /tmp/tb-regress/script_bad.lua
# (sprite + cover args same as Step 2; adjust the paths to match local fixtures)
./bin/tinybit -c <sprite.png> /tmp/tb-regress/script_ok.lua  <cover.png> /tmp/ok.tb.png  2>&1 | tail -3
./bin/tinybit -c <sprite.png> /tmp/tb-regress/script_bad.lua <cover.png> /tmp/bad.tb.png 2>&1 | tail -3
echo "bad exit code: $?"
```
Expected: `script_ok.lua` (32 621 bytes) encodes successfully; `script_bad.lua` (32 622 bytes) prints `cartridge too small to fit game (script 32622 > max 32621)` and exits with non-zero status. This is the inverse of Issue 2 — the same script that would have caused the 4-byte overrun is now rejected at the boundary.

---

## Task 4: Commit and push

**Working directory:** `/mnt/c/Users/mbrin/git/TinyBit` (default branch `master`)

- [ ] **Step 1: Stage exactly the two changes**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
git add src/tinybit src/cartridge_io.c
git status
```
Expected: two staged entries (submodule pointer counts as one, cartridge_io.c as the other). If anything else appears, investigate before continuing.

- [ ] **Step 2: Commit on `master`**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
git commit -m "$(cat <<'EOF'
adopt header-in-memory engine + cap script at safe max

Engine submodule bumped to d789a2b ("store cartridge header in
TinyBitMemory"). That removes TB_MEM_CARTRIDGE_SCRIPT_SIZE and
redefines TB_MEM_SCRIPT_SIZE to the 32622-byte cartridge script
payload.

Encoder follow-up: cartridge_size in export_cartridge now reads
TB_MEM_SCRIPT_SIZE - 1 = 32621 to reserve one byte for the
trailing NUL that encode_bytes writes (script_size + 1). This
fixes the 4-byte heap-buffer overrun at the documented max
script size (Issue 2 from tinybit-wasm/feeback.md).

Wire format is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --stat
```
Expected: one commit on `master` with two files changed (`src/tinybit`, `src/cartridge_io.c`). Working tree clean.

- [ ] **Step 3: Push to `origin/master`**

```bash
cd /mnt/c/Users/mbrin/git/TinyBit
git push origin master
```
Expected: push succeeds. This matches the engine workflow (direct-to-default-branch, no PR).

---

## Self-review checklist (for the executor)

- Did you confirm `make` produced zero **new** warnings on line 200 of `cartridge_io.c`?
- Did the 32 621-byte script encode and the 32 622-byte script reject?
- Did the encoded test cartridge exist and read as a valid 256×256 PNG?
- Were exactly two files staged in the commit (`src/tinybit`, `src/cartridge_io.c`)?
- Did the push succeed?

## Out of scope (deliberately not in any task)

- The `mem_peek` / `mem_poke` pointer-arithmetic bug in `src/tinybit/memory.c`. Pre-existing; lives upstream; separate spec.
- Introducing a shared `TB_MEM_CARTRIDGE_SCRIPT_MAX` constant in `tinybit.h` (engine) that both encoders consume. The current state (Rust encoder uses `bindings::TB_MEM_SCRIPT_SIZE - 1`, C encoder will use the same expression locally) is consistent enough; the documented "WASM is 1 byte stricter than C" caveat in `tinybit-wasm/README.md` should be removed in a tiny follow-up commit on `tinybit-wasm` once this lands.
- Adding a regression test to the desktop repo. There's no test infrastructure here yet; not a one-line addition.
- Touching `smoke.mjs`'s hard-coded `/home/mees/git/TinyBit/games/flappy.tb.png` path. Environment-specific; orthogonal.
